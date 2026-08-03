import { ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import type { AuthenticatedRequestUser } from '../auth';
import { hashToken } from '../common/utils/helpers';
import { getBangkokDateString } from '../common/utils/date.util';
import type { SqlQueryExecutor } from '../database/sql-query';
import { TeacherAccessRepository } from './teacher-access.repository';
import { TeacherAccessService } from './teacher-access.service';
import type { TeacherAccessAssignmentRow, TeacherAccessGrantRow } from './teacher-access.types';

const NOW = new Date();
const FUTURE = new Date(NOW.getTime() + 86_400_000).toISOString();
const PAST = new Date(NOW.getTime() - 86_400_000).toISOString();
const TODAY = getBangkokDateString(NOW);

const GRANT: TeacherAccessGrantRow = {
  id: '11111111-1111-4111-8111-111111111111',
  teacher_membership_id: '12',
  teacher_user_id: 44,
  teacher_username: 'teacher.one',
  teacher_display_name: 'ครู หนึ่ง',
  teacher_email: 'teacher.one@sts-demo.ac.th',
  teacher_status: 'ACTIVE',
  membership_status: 'ACTIVE',
  membership_deleted_at: null,
  school_id: 10,
  school_name: 'โรงเรียนหนึ่ง',
  school_status: 'ACTIVE',
  school_term_id: '21',
  academic_year: 2569,
  semester: 1,
  term_status: 'ACTIVE',
  term_deleted_at: null,
  term_starts_on: TODAY,
  term_ends_on: TODAY,
  token_hash: hashToken('valid-token-value-that-is-at-least-thirty-two-characters'),
  token_encrypted: 'v1:cipher',
  step_up_policy: 'NONE',
  issued_by: 1,
  issuer_name: 'admin',
  issued_at: PAST,
  expires_at: FUTURE,
  last_used_at: null,
  revoked_at: null,
  revoked_by: null,
  revocation_reason: null,
  rotated_at: null,
  rotation_count: 0,
  capabilities: ['HOMEROOM_ATTENDANCE'],
  assignment_count: 1,
};

const ASSIGNMENT: TeacherAccessAssignmentRow = {
  assignment_id: '31',
  teacher_membership_id: '12',
  school_id: 10,
  classroom_id: '41',
  school_term_id: '21',
  grade_level_id: 3,
  grade_label: 'ป.3',
  legacy_room_number: 1,
  room_code: '1',
  room_name: null,
  classroom_status: 'ACTIVE',
  card_cover_color: 'BLUE',
  has_cover_image: false,
  cover_image_position_x: 50,
  cover_image_position_y: 50,
  cover_image_scale: 1,
  assignment_kind: 'HOMEROOM',
  assignment_status: 'ACTIVE',
  subject_id: null,
  subject_code: null,
  subject_name: null,
  effective_on: null,
  effective_until: null,
};

const ACTOR: AuthenticatedRequestUser = {
  id: 1,
  username: 'admin',
  roles: ['ADMIN'],
  permissions: ['manage-teacher-access'],
  data_scope: { school_ids: [10] },
};

type RepositoryMock = jest.Mocked<
  Pick<
    TeacherAccessRepository,
    | 'withTransaction'
    | 'isSchoolInScope'
    | 'findTermForIssue'
    | 'findMembershipForIssue'
    | 'listAssignmentsForIssue'
    | 'createGrant'
    | 'getGrantDetail'
    | 'listGrants'
    | 'revokeGrant'
    | 'rotateGrantToken'
    | 'findGrantByTokenHashForUpdate'
    | 'listCapabilities'
    | 'findGrantAssignment'
    | 'isStudentInClassroom'
    | 'touchGrant'
    | 'listGrantAssignments'
    | 'listRoster'
    | 'listRosterIds'
    | 'getAlertTriggerType'
    | 'getSystemSettingValue'
    | 'listAssignmentOptions'
    | 'listMembershipsNeedingGrant'
    | 'findGrantById'
    | 'listAssignmentSlotsForDate'
    | 'findClassroomPresentation'
    | 'updateClassroomPresentation'
  >
>;

function createHarness(overrides: Partial<TeacherAccessGrantRow> = {}) {
  const grant = { ...GRANT, ...overrides };
  const repository: RepositoryMock = {
    withTransaction: jest.fn(async (operation) => await operation({} as QueryRunner)),
    isSchoolInScope: jest.fn().mockResolvedValue(true),
    findTermForIssue: jest.fn(),
    findMembershipForIssue: jest.fn(),
    listAssignmentsForIssue: jest.fn(),
    createGrant: jest.fn(),
    getGrantDetail: jest.fn().mockResolvedValue({
      grant,
      capabilities: grant.capabilities,
      assignments: [ASSIGNMENT],
    }),
    listGrants: jest.fn(),
    revokeGrant: jest.fn(),
    rotateGrantToken: jest.fn(),
    findGrantByTokenHashForUpdate: jest.fn().mockResolvedValue(grant),
    listCapabilities: jest.fn().mockResolvedValue(grant.capabilities),
    findGrantAssignment: jest.fn().mockResolvedValue(ASSIGNMENT),
    isStudentInClassroom: jest.fn().mockResolvedValue(true),
    touchGrant: jest.fn(),
    listGrantAssignments: jest.fn().mockResolvedValue([ASSIGNMENT]),
    listRoster: jest.fn().mockResolvedValue([]),
    listRosterIds: jest.fn().mockResolvedValue([]),
    getAlertTriggerType: jest.fn().mockResolvedValue('DAILY'),
    getSystemSettingValue: jest
      .fn()
      .mockImplementation((key: string) =>
        Promise.resolve(key === 'TEACHER_ACCESS_DEFAULT_EXPIRY_POLICY' ? 'TERM_END' : 'NONE'),
      ),
    listAssignmentOptions: jest.fn().mockResolvedValue([]),
    listMembershipsNeedingGrant: jest.fn().mockResolvedValue([]),
    findGrantById: jest.fn().mockResolvedValue(grant),
    listAssignmentSlotsForDate: jest.fn().mockResolvedValue([]),
    findClassroomPresentation: jest.fn().mockResolvedValue({
      card_cover_color: '#4F86E8',
      cover_image_storage_key: 'classroom-covers/old.png',
      cover_image_position_x: 40,
      cover_image_position_y: 60,
      cover_image_scale: 1.2,
      updated_at: NOW,
    }),
    updateClassroomPresentation: jest.fn().mockResolvedValue(true),
  };
  const auditLog = {
    recordAtomic: jest.fn().mockResolvedValue(undefined),
    record: jest.fn().mockResolvedValue(undefined),
  };
  const attendance = { saveAttendanceWithinTransaction: jest.fn() };
  const automation = { checkConsecutiveAbsences: jest.fn() };
  const risk = { enqueueStudents: jest.fn().mockResolvedValue(undefined) };
  const tokenEncryption = {
    encrypt: jest.fn((value: string) => `v1:${value}`),
    decrypt: jest.fn((value: string) => value.replace(/^v1:/, '')),
  };
  const emailService = { sendOTP: jest.fn().mockResolvedValue({ success: true }) };
  const otpStore = {
    issue: jest.fn().mockResolvedValue(new Date(Date.now() + 600_000)),
    verify: jest.fn().mockResolvedValue('ok'),
    clear: jest.fn().mockResolvedValue(undefined),
  };
  const magicSessionStore = {
    issue: jest.fn().mockResolvedValue('ms_session'),
    isVerified: jest.fn().mockResolvedValue(true),
  };
  const storage = {
    kind: 'private-object',
    save: jest.fn().mockResolvedValue(undefined),
    saveStream: jest.fn().mockResolvedValue(undefined),
    resolve: jest.fn(),
    open: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const service = new TeacherAccessService(
    repository as unknown as TeacherAccessRepository,
    auditLog as never,
    attendance as never,
    automation as never,
    risk as never,
    tokenEncryption as never,
    emailService as never,
    otpStore as never,
    magicSessionStore as never,
    storage as never,
    {} as never,
    {} as never,
  );
  return {
    service,
    repository,
    auditLog,
    attendance,
    grant,
    tokenEncryption,
    emailService,
    otpStore,
    magicSessionStore,
    storage,
  };
}

describe('TeacherAccessService', () => {
  it('returns only server-derived teacher and assignment context for a valid token', async () => {
    const { service, repository } = createHarness();

    const result = await service.getPublicContext(
      'valid-token-value-that-is-at-least-thirty-two-characters',
    );

    expect(result.data).toMatchObject({
      teacherDisplayName: 'ครู หนึ่ง',
      schoolId: 10,
      schoolTermId: '21',
      capabilities: ['HOMEROOM_ATTENDANCE'],
    });
    expect(result.data).not.toHaveProperty('token');
    expect(repository.findGrantByTokenHashForUpdate).toHaveBeenCalled();
    expect(repository.touchGrant).toHaveBeenCalledWith(GRANT.id, expect.anything());
  });

  it('exposes the canonical enrollment snapshot id without removing studentUuid', async () => {
    const { service, repository } = createHarness();
    const studentUuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    repository.listRoster.mockResolvedValue([
      {
        student_uuid: studentUuid,
        first_name: 'สมชาย',
        last_name: 'ใจดี',
        student_status_code: 10,
        student_status_label: 'กำลังศึกษา',
        total_count: 1,
      },
    ]);

    await expect(
      service.listPublicRoster(
        'valid-token-value-that-is-at-least-thirty-two-characters',
        31,
        undefined,
        1,
        10,
      ),
    ).resolves.toMatchObject({
      data: [{ studentUuid, studentTermId: studentUuid }],
    });
  });

  it.each([
    ['revoked', { revoked_at: NOW.toISOString() }, GoneException],
    ['expired', { expires_at: PAST }, GoneException],
    ['closed term', { term_status: 'CLOSED' }, ForbiddenException],
    ['inactive teacher', { membership_status: 'INACTIVE' }, ForbiddenException],
    ['disabled user', { teacher_status: 'INACTIVE' }, ForbiddenException],
    ['deleted membership', { membership_deleted_at: NOW.toISOString() }, ForbiddenException],
    ['inactive school', { school_status: 'INACTIVE' }, ForbiddenException],
  ] as const)('denies a %s grant and audits the known grant', async (_label, change, errorType) => {
    const { service, auditLog } = createHarness(change);

    await expect(
      service.getPublicContext('valid-token-value-that-is-at-least-thirty-two-characters'),
    ).rejects.toBeInstanceOf(errorType);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'TEACHER_ACCESS_GRANT_DENIED', targetId: GRANT.id }),
    );
  });

  it('denies a tampered token without creating an attacker-controlled audit row', async () => {
    const { service, repository, auditLog } = createHarness();
    repository.findGrantByTokenHashForUpdate.mockResolvedValue(null);

    await expect(
      service.getPublicContext('tampered-token-value-that-is-at-least-thirty-two-characters'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('denies a capability mismatch before the domain callback', async () => {
    const { service } = createHarness();
    const callback = jest.fn();

    await expect(
      service.withActiveGrantContext(
        'valid-token-value-that-is-at-least-thirty-two-characters',
        {
          capability: 'TEACHER_OBSERVATION',
          assignmentId: 31,
          operation: 'TEST',
        },
        callback,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(callback).not.toHaveBeenCalled();
  });

  it.each([
    ['school', { school_id: 99 }],
    ['term', { school_term_id: '99' }],
    ['teacher', { teacher_membership_id: '99' }],
  ] as const)('denies an assignment with a mismatched %s', async (_label, change) => {
    const { service, repository } = createHarness();
    repository.findGrantAssignment.mockResolvedValue({ ...ASSIGNMENT, ...change });

    await expect(
      service.withActiveGrantContext(
        'valid-token-value-that-is-at-least-thirty-two-characters',
        { capability: 'HOMEROOM_ATTENDANCE', assignmentId: 31, operation: 'TEST' },
        () => Promise.resolve(undefined),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies an inactive classroom assignment', async () => {
    const { service, repository } = createHarness();
    repository.findGrantAssignment.mockResolvedValue({
      ...ASSIGNMENT,
      classroom_status: 'INACTIVE',
    });

    await expect(
      service.withActiveGrantContext(
        'valid-token-value-that-is-at-least-thirty-two-characters',
        { capability: 'HOMEROOM_ATTENDANCE', assignmentId: 31, operation: 'TEST' },
        () => Promise.resolve(undefined),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies a student outside the assignment roster', async () => {
    const { service, repository } = createHarness({
      capabilities: ['TEACHER_OBSERVATION'],
    });
    repository.listCapabilities.mockResolvedValue(['TEACHER_OBSERVATION']);
    repository.findGrantAssignment.mockResolvedValue({
      ...ASSIGNMENT,
      assignment_kind: 'SUBJECT',
      subject_id: 8,
    });
    repository.isStudentInClassroom.mockResolvedValue(false);

    await expect(
      service.resolveActiveGrant(
        'valid-token-value-that-is-at-least-thirty-two-characters',
        'TEACHER_OBSERVATION',
        31,
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('fails closed when an issuer from school A requests school B', async () => {
    const { service, repository } = createHarness();
    repository.isSchoolInScope.mockResolvedValue(false);

    await expect(service.listGrants({ schoolId: 20 }, ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.listGrants).not.toHaveBeenCalled();
  });

  it('passes the Bangkok business date to assignment-option filtering', async () => {
    const { service, repository } = createHarness();

    await service.listAssignmentOptions(
      { schoolId: 10, schoolTermId: 21, teacherMembershipId: 12 },
      ACTOR,
    );

    expect(repository.listAssignmentOptions).toHaveBeenCalledWith({
      schoolId: 10,
      schoolTermId: 21,
      teacherMembershipIds: [12],
      onDate: getBangkokDateString(),
    });
  });

  it('adapts the TypeORM query runner before saving public attendance', async () => {
    const { service, repository, attendance } = createHarness();
    const studentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const rawQuery = jest.fn().mockResolvedValue({ records: [{ ok: true }], affected: 1 });
    repository.withTransaction.mockImplementation(
      async (operation) => await operation({ query: rawQuery } as unknown as QueryRunner),
    );
    repository.listRosterIds.mockResolvedValue([studentId]);
    attendance.saveAttendanceWithinTransaction.mockImplementation(
      async (_records: unknown, _context: unknown, executor: SqlQueryExecutor) => {
        await expect(executor.query('SELECT 1')).resolves.toEqual({
          rows: [{ ok: true }],
          rowCount: 1,
        });
        return {
          session: { id: 'session-1', status: 'SUBMITTED', revision: 1 },
          calendarConfigured: true,
          affectedStudentIds: [studentId],
        };
      },
    );

    await expect(
      service.savePublicAttendance('valid-token-value-that-is-at-least-thirty-two-characters', {
        assignmentId: 31,
        date: TODAY,
        records: [{ studentId, status: 'P_PRESENT' }],
      }),
    ).resolves.toMatchObject({
      data: { session: { id: 'session-1' }, calendarConfigured: true },
    });
    expect(rawQuery).toHaveBeenCalledWith('SELECT 1', undefined, true);
    expect(attendance.saveAttendanceWithinTransaction).toHaveBeenCalledTimes(1);
  });

  it('requires the dedicated issuer permission instead of school-structure authority', async () => {
    const { service } = createHarness();

    await expect(
      service.listGrants({ schoolId: 10 }, { ...ACTOR, permissions: ['manage-school-structure'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['TERM_END', null, '2099-12-31T16:59:59.999Z'],
    ['ASSIGNMENT_END', '2099-06-30', '2099-06-30T16:59:59.999Z'],
  ] as const)(
    'resolves default expiry from the %s system setting',
    async (expiryPolicy, assignmentEnd, expectedExpiry) => {
      const { service, repository } = createHarness();
      repository.findTermForIssue.mockResolvedValue({
        id: '21',
        school_id: 10,
        academic_year: 2569,
        semester: 1,
        status: 'ACTIVE',
        starts_on: '2099-01-01',
        ends_on: '2099-12-31',
      });
      repository.findMembershipForIssue.mockResolvedValue({
        id: '12',
        school_id: 10,
        teacher_user_id: 44,
        membership_status: 'ACTIVE',
        teacher_status: 'ACTIVE',
      });
      repository.listAssignmentOptions.mockResolvedValue([
        { ...ASSIGNMENT, effective_until: assignmentEnd },
      ]);
      repository.createGrant.mockResolvedValue(GRANT.id);
      repository.getSystemSettingValue.mockImplementation((key: string) =>
        Promise.resolve(key === 'TEACHER_ACCESS_DEFAULT_EXPIRY_POLICY' ? expiryPolicy : 'NONE'),
      );

      await service.issueGrant(
        { teacherMembershipId: 12, schoolTermId: 21 },
        ACTOR,
        'https://sts.example',
      );

      expect(repository.createGrant).toHaveBeenCalledWith(
        expect.objectContaining({ expiresAt: new Date(expectedExpiry), stepUpPolicy: 'NONE' }),
        expect.anything(),
      );
    },
  );

  function stubIssuableTerm(repository: RepositoryMock): void {
    repository.findTermForIssue.mockResolvedValue({
      id: '21',
      school_id: 10,
      academic_year: 2569,
      semester: 1,
      status: 'ACTIVE',
      starts_on: '2099-01-01',
      ends_on: '2099-12-31',
    });
    repository.findMembershipForIssue.mockResolvedValue({
      id: '12',
      school_id: 10,
      teacher_user_id: 44,
      membership_status: 'ACTIVE',
      teacher_status: 'ACTIVE',
    });
    repository.listAssignmentOptions.mockResolvedValue([ASSIGNMENT]);
    repository.createGrant.mockResolvedValue(GRANT.id);
  }

  it('fails closed when a configured step-up policy is not implemented', async () => {
    const { service, repository } = createHarness();
    stubIssuableTerm(repository);
    repository.getSystemSettingValue.mockImplementation((key: string) =>
      Promise.resolve(key === 'TEACHER_ACCESS_DEFAULT_EXPIRY_POLICY' ? 'TERM_END' : 'THAID'),
    );

    await expect(
      service.issueGrant(
        { teacherMembershipId: 12, schoolTermId: 21 },
        ACTOR,
        'https://sts.example',
      ),
    ).rejects.toThrow('ยังไม่รองรับ');
    expect(repository.createGrant).not.toHaveBeenCalled();
  });

  it('issues an email-OTP link that covers every assignment of the teacher', async () => {
    const { service, repository, tokenEncryption } = createHarness();
    stubIssuableTerm(repository);
    repository.listAssignmentOptions.mockResolvedValue([
      ASSIGNMENT,
      { ...ASSIGNMENT, assignment_id: '32', assignment_kind: 'SUBJECT', subject_id: 7 },
    ]);
    repository.getSystemSettingValue.mockImplementation((key: string) =>
      Promise.resolve(key === 'TEACHER_ACCESS_DEFAULT_EXPIRY_POLICY' ? 'TERM_END' : 'EMAIL_OTP'),
    );

    await service.issueGrant(
      { teacherMembershipId: 12, schoolTermId: 21 },
      ACTOR,
      'https://sts.example',
    );

    expect(repository.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        stepUpPolicy: 'EMAIL_OTP',
        assignmentIds: [31, 32],
        capabilities: ['HOMEROOM_ATTENDANCE', 'SUBJECT_ATTENDANCE', 'TEACHER_OBSERVATION'],
      }),
      expect.anything(),
    );
    expect(tokenEncryption.encrypt).toHaveBeenCalled();
  });

  it('refuses to issue a link for a teacher with no class this term', async () => {
    const { service, repository } = createHarness();
    stubIssuableTerm(repository);
    repository.listAssignmentOptions.mockResolvedValue([]);

    await expect(
      service.issueGrant(
        { teacherMembershipId: 12, schoolTermId: 21 },
        ACTOR,
        'https://sts.example',
      ),
    ).rejects.toThrow('ยังไม่มีห้องหรือรายวิชา');
    expect(repository.createGrant).not.toHaveBeenCalled();
  });

  it('demands an OTP session before a step-up link may read anything', async () => {
    const { service, magicSessionStore } = createHarness({ step_up_policy: 'EMAIL_OTP' });
    magicSessionStore.isVerified.mockResolvedValue(false);

    await expect(
      service.getPublicContext('valid-token-value-that-is-at-least-thirty-two-characters'),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('issues a magic session only after the stored OTP matches', async () => {
    const { service, otpStore, magicSessionStore } = createHarness({ step_up_policy: 'EMAIL_OTP' });
    otpStore.verify.mockResolvedValue('wrong');

    await expect(
      service.verifyOtp('valid-token-value-that-is-at-least-thirty-two-characters', '123456'),
    ).rejects.toThrow('ไม่ถูกต้อง');
    expect(magicSessionStore.issue).not.toHaveBeenCalled();

    otpStore.verify.mockResolvedValue('ok');
    await expect(
      service.verifyOtp('valid-token-value-that-is-at-least-thirty-two-characters', '123456'),
    ).resolves.toMatchObject({ data: { sessionToken: 'ms_session' } });
  });

  it('sends the OTP to the teacher address and never returns it in full', async () => {
    const { service, emailService } = createHarness({ step_up_policy: 'EMAIL_OTP' });

    const result = await service.requestOtp(
      'valid-token-value-that-is-at-least-thirty-two-characters',
    );

    expect(emailService.sendOTP).toHaveBeenCalledWith(
      'teacher.one@sts-demo.ac.th',
      expect.stringMatching(/^\d{6}$/),
      expect.any(Number),
    );
    expect(result.data.maskedEmail).toBe('te*********@sts-demo.ac.th');
    expect(JSON.stringify(result)).not.toContain(
      (emailService.sendOTP.mock.calls[0] as string[])[1],
    );
  });

  it('rotates the token so the old hash is denied and the new link resolves', async () => {
    const { service, repository } = createHarness();
    let activeHash = GRANT.token_hash;
    repository.rotateGrantToken.mockImplementation((_id, nextHash) => {
      activeHash = nextHash;
      return Promise.resolve();
    });
    repository.getGrantDetail.mockResolvedValue({
      grant: GRANT,
      capabilities: GRANT.capabilities,
      assignments: [ASSIGNMENT],
    });
    repository.findGrantByTokenHashForUpdate.mockImplementation((candidate) =>
      Promise.resolve(candidate === activeHash ? GRANT : null),
    );

    const rotated = await service.rotateGrant(GRANT.id, ACTOR, 'https://sts.example');
    const nextToken = new URL(rotated.data.accessUrl).hash.replace('#token=', '');

    await expect(
      service.getPublicContext('valid-token-value-that-is-at-least-thirty-two-characters'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getPublicContext(nextToken)).resolves.toHaveProperty(
      'data.teacherDisplayName',
      'ครู หนึ่ง',
    );
  });

  it('serializes public use and revoke through the repository transaction boundary', async () => {
    const { service, repository } = createHarness();
    let releaseUse!: () => void;
    const usePaused = new Promise<void>((resolve) => {
      releaseUse = resolve;
    });
    let transactionTail = Promise.resolve();
    repository.withTransaction.mockImplementation(async (operation) => {
      const previous = transactionTail;
      let release!: () => void;
      transactionTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        return await operation({} as QueryRunner);
      } finally {
        release();
      }
    });
    repository.listGrantAssignments.mockImplementationOnce(async () => {
      await usePaused;
      return [ASSIGNMENT];
    });

    const usePromise = service.getPublicContext(
      'valid-token-value-that-is-at-least-thirty-two-characters',
    );
    await Promise.resolve();
    let revokeSettled = false;
    const revokePromise = service.revokeGrant(GRANT.id, 'เปลี่ยนครู', ACTOR).then(() => {
      revokeSettled = true;
    });
    await Promise.resolve();
    expect(revokeSettled).toBe(false);

    releaseUse();
    await Promise.all([usePromise, revokePromise]);
    expect(repository.revokeGrant).toHaveBeenCalled();
  });

  it('rejects an invalid teacher link before persisting a classroom cover', async () => {
    const { service, repository, storage } = createHarness();
    repository.findGrantByTokenHashForUpdate.mockResolvedValue(null);

    await expect(
      service.updatePublicClassroomPresentation(
        'invalid-token-value-that-is-at-least-thirty-two-characters',
        { assignmentId: 31 },
        {
          buffer: Buffer.from('not-read-before-auth'),
          mimetype: 'image/png',
        } as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(storage.save).not.toHaveBeenCalled();
  });

  it('deletes a newly uploaded cover when the classroom update rolls back', async () => {
    const { service, repository, storage } = createHarness();
    repository.updateClassroomPresentation.mockRejectedValueOnce(new Error('database unavailable'));
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );

    await expect(
      service.updatePublicClassroomPresentation(
        'valid-token-value-that-is-at-least-thirty-two-characters',
        { assignmentId: 31 },
        { buffer: png, mimetype: 'image/png' } as Express.Multer.File,
      ),
    ).rejects.toThrow('database unavailable');

    expect(storage.save).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith(expect.stringMatching(/^classroom-covers\//));
  });
});
