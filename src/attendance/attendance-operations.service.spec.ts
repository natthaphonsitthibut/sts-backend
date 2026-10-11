import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AttendanceOperationsRepository } from './attendance-operations.repository';
import { AttendanceOperationsService } from './attendance-operations.service';
import type { QueryExecutor } from './attendance.types';
import { RiskProfileService } from '../risk-profile/risk-profile.service';

const actor = {
  id: 5,
  username: 'school-admin',
  roles: ['ADMIN_SCHOOL'],
  permissions: ['manage-school-structure'],
  data_scope: { school_ids: [10010002] },
};

const draftTerm = {
  id: '10',
  school_id: 10010002,
  school_name: 'โรงเรียนทดสอบ',
  academic_year: 2569,
  semester: 1,
  starts_on: '2026-05-01',
  ends_on: '2026-10-31',
  status: 'DRAFT' as const,
};

function auditLogMock() {
  return { recordAtomic: jest.fn().mockResolvedValue(undefined) };
}

function transactionMock() {
  return jest.fn(
    async (callback: (executor: QueryExecutor) => Promise<unknown>): Promise<unknown> =>
      await callback({ query: jest.fn() }),
  );
}

describe('AttendanceOperationsService', () => {
  it('audits every edited field and synchronizes labels before committing', async () => {
    const updated = {
      ...draftTerm,
      academic_year: 2570,
      semester: 2,
      starts_on: '2027-05-01',
      ends_on: '2027-10-31',
      status: 'ACTIVE' as const,
    };
    const events: string[] = [];
    const executor = { query: jest.fn() };
    const repository = {
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      withTransaction: jest.fn(async (callback: (value: QueryExecutor) => Promise<unknown>) => {
        const result = await callback(executor);
        events.push('commit');
        return result;
      }),
      findTermByIdForUpdate: jest.fn().mockResolvedValue(draftTerm),
      findTermWriteConflict: jest.fn().mockResolvedValue(null),
      updateTerm: jest.fn().mockResolvedValue(updated),
      synchronizeTermEnrollmentLabels: jest.fn(() => {
        events.push('sync');
        return Promise.resolve({ enrollments: 3, riskProfiles: 2 });
      }),
      upsertTerm: jest.fn(),
    };
    const auditLog = {
      recordAtomic: jest.fn(() => {
        events.push('audit');
        return Promise.resolve();
      }),
    };
    const risk = {
      enqueueFull: jest.fn(() => {
        events.push('refresh');
        return Promise.resolve();
      }),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
      auditLog as unknown as AuditLogService,
      risk as unknown as RiskProfileService,
    );
    const input = {
      termId: 10,
      schoolId: draftTerm.school_id,
      academicYear: 2570,
      semester: 2,
      startsOn: updated.starts_on,
      endsOn: updated.ends_on,
      status: updated.status,
    };

    await expect(service.upsertTerm(input, actor)).resolves.toMatchObject({ data: { id: '10' } });
    expect(repository.upsertTerm).not.toHaveBeenCalled();
    expect(repository.synchronizeTermEnrollmentLabels).toHaveBeenCalledWith(
      10,
      { ...input, actorUserId: actor.id },
      executor,
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        targetId: '10',
        metadata: {
          op: 'update',
          schoolId: draftTerm.school_id,
          before: {
            academicYear: 2569,
            semester: 1,
            startsOn: draftTerm.starts_on,
            endsOn: draftTerm.ends_on,
            status: 'DRAFT',
          },
          after: {
            academicYear: 2570,
            semester: 2,
            startsOn: updated.starts_on,
            endsOn: updated.ends_on,
            status: 'ACTIVE',
          },
          synchronized: { enrollments: 3, riskProfiles: 2 },
        },
      }),
      executor,
    );
    expect(events).toEqual(['sync', 'audit', 'commit', 'refresh']);
  });

  it.each(['TERM_IDENTITY', 'ACTIVE_TERM', 'ENROLLMENT_IDENTITY', 'STUDENT_NUMBER'])(
    'rejects %s before any edit or audit',
    async (conflict) => {
      const repository = {
        isSchoolInScope: jest.fn().mockResolvedValue(true),
        withTransaction: transactionMock(),
        findTermByIdForUpdate: jest.fn().mockResolvedValue(draftTerm),
        findTermWriteConflict: jest.fn().mockResolvedValue(conflict),
        updateTerm: jest.fn(),
        synchronizeTermEnrollmentLabels: jest.fn(),
      };
      const audit = auditLogMock();
      const service = new AttendanceOperationsService(
        repository as unknown as AttendanceOperationsRepository,
        audit as unknown as AuditLogService,
      );
      await expect(
        service.upsertTerm(
          {
            termId: 10,
            schoolId: draftTerm.school_id,
            academicYear: 2570,
            semester: 2,
            startsOn: draftTerm.starts_on,
            endsOn: draftTerm.ends_on,
            status: 'DRAFT',
          },
          actor,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(repository.updateTerm).not.toHaveBeenCalled();
      expect(repository.synchronizeTermEnrollmentLabels).not.toHaveBeenCalled();
      expect(audit.recordAtomic).not.toHaveBeenCalled();
    },
  );

  it('creating an existing natural key cannot update old terms or enrollments', async () => {
    const repository = {
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      withTransaction: transactionMock(),
      findTermWriteConflict: jest.fn().mockResolvedValue('TERM_IDENTITY'),
      upsertTerm: jest.fn(),
      updateTerm: jest.fn(),
      synchronizeTermEnrollmentLabels: jest.fn(),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
      auditLogMock() as unknown as AuditLogService,
    );
    await expect(
      service.upsertTerm(
        {
          schoolId: draftTerm.school_id,
          academicYear: 2569,
          semester: 1,
          startsOn: draftTerm.starts_on,
          endsOn: draftTerm.ends_on,
          status: 'DRAFT',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.upsertTerm).not.toHaveBeenCalled();
    expect(repository.updateTerm).not.toHaveBeenCalled();
    expect(repository.synchronizeTermEnrollmentLabels).not.toHaveBeenCalled();
  });
  it('denies a school outside the authenticated scope', async () => {
    const repository = { isSchoolInScope: jest.fn().mockResolvedValue(false) };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
      auditLogMock() as unknown as AuditLogService,
    );

    await expect(
      service.listTerms(10010002, {
        ...actor,
        data_scope: { school_ids: [20020003] },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('activates a valid term without requiring calendar coverage', async () => {
    const repository = {
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      withTransaction: transactionMock(),
      findTermWriteConflict: jest.fn().mockResolvedValue(null),
      synchronizeTermEnrollmentLabels: jest
        .fn()
        .mockResolvedValue({ enrollments: 3, riskProfiles: 2 }),
      upsertTerm: jest.fn().mockResolvedValue({ ...draftTerm, status: 'ACTIVE' }),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
      auditLogMock() as unknown as AuditLogService,
    );

    await expect(
      service.upsertTerm(
        {
          schoolId: 10010002,
          academicYear: 2569,
          semester: 1,
          startsOn: '2026-05-01',
          endsOn: '2026-10-31',
          status: 'ACTIVE',
        },
        actor,
      ),
    ).resolves.toMatchObject({ data: { id: '10', status: 'ACTIVE' } });
    expect(repository.upsertTerm).toHaveBeenCalledTimes(1);
  });

  it('rewrites the opened term when the year or semester changes', async () => {
    const renamed = { ...draftTerm, academic_year: 2570, semester: 2 };
    const repository = {
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      withTransaction: transactionMock(),
      findTermWriteConflict: jest.fn().mockResolvedValue(null),
      synchronizeTermEnrollmentLabels: jest
        .fn()
        .mockResolvedValue({ enrollments: 3, riskProfiles: 2 }),
      findTermByIdForUpdate: jest.fn().mockResolvedValue(draftTerm),
      updateTerm: jest.fn().mockResolvedValue(renamed),
      upsertTerm: jest.fn(),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
      auditLogMock() as unknown as AuditLogService,
    );

    await expect(
      service.upsertTerm(
        {
          termId: 10,
          schoolId: 10010002,
          academicYear: 2570,
          semester: 2,
          startsOn: '2026-05-01',
          endsOn: '2026-10-31',
          status: 'DRAFT',
        },
        actor,
      ),
    ).resolves.toMatchObject({ data: { id: '10', academicYear: 2570, semester: 2 } });
    // Upserting on the natural key here would leave the original row behind.
    expect(repository.upsertTerm).not.toHaveBeenCalled();
    expect(repository.updateTerm).toHaveBeenCalledTimes(1);
  });

  it('refuses to edit a term that belongs to another school', async () => {
    const repository = {
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      withTransaction: transactionMock(),
      findTermWriteConflict: jest.fn().mockResolvedValue(null),
      synchronizeTermEnrollmentLabels: jest
        .fn()
        .mockResolvedValue({ enrollments: 3, riskProfiles: 2 }),
      findTermByIdForUpdate: jest.fn().mockResolvedValue({ ...draftTerm, school_id: 20020003 }),
      updateTerm: jest.fn(),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
      auditLogMock() as unknown as AuditLogService,
    );

    await expect(
      service.upsertTerm(
        {
          termId: 10,
          schoolId: 10010002,
          academicYear: 2569,
          semester: 1,
          startsOn: '2026-05-01',
          endsOn: '2026-10-31',
          status: 'DRAFT',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.updateTerm).not.toHaveBeenCalled();
  });

  it('names the natural-key conflict when a rename collides', async () => {
    const repository = {
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      withTransaction: transactionMock(),
      findTermWriteConflict: jest.fn().mockResolvedValue(null),
      synchronizeTermEnrollmentLabels: jest
        .fn()
        .mockResolvedValue({ enrollments: 3, riskProfiles: 2 }),
      findTermByIdForUpdate: jest.fn().mockResolvedValue(draftTerm),
      updateTerm: jest.fn().mockRejectedValue(
        Object.assign(new Error('duplicate key'), {
          code: '23505',
          constraint: 'uq_school_terms_school_year_semester',
        }),
      ),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
      auditLogMock() as unknown as AuditLogService,
    );

    await expect(
      service.upsertTerm(
        {
          termId: 10,
          schoolId: 10010002,
          academicYear: 2570,
          semester: 2,
          startsOn: '2026-05-01',
          endsOn: '2026-10-31',
          status: 'DRAFT',
        },
        actor,
      ),
    ).rejects.toThrow('โรงเรียนนี้มีภาคเรียนของปีและภาคเรียนนี้อยู่แล้ว');
  });

  it('rejects an invalid term date range', async () => {
    const repository = { isSchoolInScope: jest.fn().mockResolvedValue(true) };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
      auditLogMock() as unknown as AuditLogService,
    );

    await expect(
      service.upsertTerm(
        {
          schoolId: 10010002,
          academicYear: 2569,
          semester: 1,
          startsOn: '2026-10-31',
          endsOn: '2026-05-01',
          status: 'DRAFT',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hard deletes an unused draft term and records who removed it', async () => {
    const repository = {
      findTermById: jest.fn().mockResolvedValue(draftTerm),
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      withTransaction: transactionMock(),
      findTermWriteConflict: jest.fn().mockResolvedValue(null),
      synchronizeTermEnrollmentLabels: jest
        .fn()
        .mockResolvedValue({ enrollments: 3, riskProfiles: 2 }),
      findTermByIdForUpdate: jest.fn().mockResolvedValue(draftTerm),
      deleteTerm: jest.fn().mockResolvedValue('10'),
    };
    const auditLog = auditLogMock();
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
      auditLog as unknown as AuditLogService,
    );

    await expect(service.deleteTerm(10, actor)).resolves.toEqual({ data: { id: '10' } });
    expect(repository.deleteTerm).toHaveBeenCalledWith(10, expect.any(Object));
    // The delete is irreversible, so the audit entry is the only trace left.
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MASTER_DATA_EDIT',
        targetType: 'school_terms',
        targetId: '10',
        actorUserId: actor.id,
        metadata: {
          op: 'delete',
          schoolId: draftTerm.school_id,
          academicYear: draftTerm.academic_year,
          semester: draftTerm.semester,
        },
      }),
      expect.any(Object),
    );
  });

  it('rejects deletion once a term is active', async () => {
    const activeTerm = { ...draftTerm, status: 'ACTIVE' as const };
    const repository = {
      findTermById: jest.fn().mockResolvedValue(activeTerm),
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      withTransaction: transactionMock(),
      findTermWriteConflict: jest.fn().mockResolvedValue(null),
      synchronizeTermEnrollmentLabels: jest
        .fn()
        .mockResolvedValue({ enrollments: 3, riskProfiles: 2 }),
      findTermByIdForUpdate: jest.fn().mockResolvedValue(activeTerm),
      deleteTerm: jest.fn(),
    };
    const auditLog = auditLogMock();
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
      auditLog as unknown as AuditLogService,
    );

    await expect(service.deleteTerm(10, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(repository.deleteTerm).not.toHaveBeenCalled();
    expect(auditLog.recordAtomic).not.toHaveBeenCalled();
  });

  it('maps a used draft term foreign-key violation to a conflict', async () => {
    const repository = {
      findTermById: jest.fn().mockResolvedValue(draftTerm),
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      withTransaction: transactionMock(),
      findTermWriteConflict: jest.fn().mockResolvedValue(null),
      synchronizeTermEnrollmentLabels: jest
        .fn()
        .mockResolvedValue({ enrollments: 3, riskProfiles: 2 }),
      findTermByIdForUpdate: jest.fn().mockResolvedValue(draftTerm),
      deleteTerm: jest.fn().mockRejectedValue({ code: '23503' }),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
      auditLogMock() as unknown as AuditLogService,
    );

    await expect(service.deleteTerm(10, actor)).rejects.toBeInstanceOf(ConflictException);
  });
});
