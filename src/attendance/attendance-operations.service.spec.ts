import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AttendanceOperationsRepository } from './attendance-operations.repository';
import { AttendanceOperationsService } from './attendance-operations.service';
import type { QueryExecutor } from './attendance.types';

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

function transactionMock() {
  return jest.fn(
    async (callback: (executor: QueryExecutor) => Promise<unknown>): Promise<unknown> =>
      await callback({ query: jest.fn() }),
  );
}

describe('AttendanceOperationsService', () => {
  it('denies a school outside the authenticated scope', async () => {
    const repository = { isSchoolInScope: jest.fn().mockResolvedValue(false) };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
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
      upsertTerm: jest.fn().mockResolvedValue({ ...draftTerm, status: 'ACTIVE' }),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
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
      findTermByIdForUpdate: jest.fn().mockResolvedValue(draftTerm),
      updateTerm: jest.fn().mockResolvedValue(renamed),
      upsertTerm: jest.fn(),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
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
      findTermByIdForUpdate: jest.fn().mockResolvedValue({ ...draftTerm, school_id: 20020003 }),
      updateTerm: jest.fn(),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
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

  it('hard deletes an unused draft term', async () => {
    const repository = {
      findTermById: jest.fn().mockResolvedValue(draftTerm),
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      withTransaction: transactionMock(),
      findTermByIdForUpdate: jest.fn().mockResolvedValue(draftTerm),
      deleteTerm: jest.fn().mockResolvedValue('10'),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
    );

    await expect(service.deleteTerm(10, actor)).resolves.toEqual({ data: { id: '10' } });
    expect(repository.deleteTerm).toHaveBeenCalledWith(10, expect.any(Object));
  });

  it('rejects deletion once a term is active', async () => {
    const activeTerm = { ...draftTerm, status: 'ACTIVE' as const };
    const repository = {
      findTermById: jest.fn().mockResolvedValue(activeTerm),
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      withTransaction: transactionMock(),
      findTermByIdForUpdate: jest.fn().mockResolvedValue(activeTerm),
      deleteTerm: jest.fn(),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
    );

    await expect(service.deleteTerm(10, actor)).rejects.toBeInstanceOf(ConflictException);
    expect(repository.deleteTerm).not.toHaveBeenCalled();
  });

  it('maps a used draft term foreign-key violation to a conflict', async () => {
    const repository = {
      findTermById: jest.fn().mockResolvedValue(draftTerm),
      isSchoolInScope: jest.fn().mockResolvedValue(true),
      withTransaction: transactionMock(),
      findTermByIdForUpdate: jest.fn().mockResolvedValue(draftTerm),
      deleteTerm: jest.fn().mockRejectedValue({ code: '23503' }),
    };
    const service = new AttendanceOperationsService(
      repository as unknown as AttendanceOperationsRepository,
    );

    await expect(service.deleteTerm(10, actor)).rejects.toBeInstanceOf(ConflictException);
  });
});
