import { TEACHER_ACCESS_NO_ASSIGNMENT_REASON } from './teacher-access.constants';
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
    | 'listGrantsForDelivery'
    | 'describeMembershipsForGrant'
    | 'findGrantById'
    | 'syncGrantScopeFromAssignments'
    | 'listAssignmentSlotsForDate'
    | 'listRecentClassroomSchoolDays'
    | 'ensureDemoSchoolDays'
    | 'hasNonDemoAttendanceSessions'
    | 'listClassroomSlotsForDate'
    | 'deleteClassroomRecentAttendance'
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
    listGrantsForDelivery: jest.fn().mockResolvedValue([]),
    describeMembershipsForGrant: jest.fn().mockResolvedValue([]),
    findGrantById: jest.fn().mockResolvedValue(grant),
    syncGrantScopeFromAssignments: jest.fn().mockResolvedValue(undefined),
    listAssignmentSlotsForDate: jest.fn().mockResolvedValue([]),
    listRecentClassroomSchoolDays: jest
      .fn()
      .mockResolvedValue(['2026-08-03', '2026-08-04', '2026-08-05']),
    ensureDemoSchoolDays: jest.fn().mockResolvedValue(undefined),
    hasNonDemoAttendanceSessions: jest.fn().mockResolvedValue(false),
    listClassroomSlotsForDate: jest.fn().mockResolvedValue([{ id: '71' }]),
    deleteClassroomRecentAttendance: jest.fn().mockResolvedValue(3),
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
  const automation = { checkConsecutiveAbsences: jest.fn().mockResolvedValue([]) };
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
  const messaging = {
    isEnabled: jest.fn().mockReturnValue(true),
    sendMessages: jest.fn().mockResolvedValue([]),
  };
  const teacherMessaging = { markUnreachable: jest.fn().mockResolvedValue(undefined) };
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
    messaging as never,
    teacherMessaging as never,
    storage as never,
    {} as never,
    {} as never,
  );
  return {
    service,
    messaging,
    teacherMessaging,
    repository,
    auditLog,
    attendance,
    grant,
    tokenEncryption,
    emailService,
    otpStore,
    magicSessionStore,
    storage,
    automation,
    risk,
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
    expect(repository.syncGrantScopeFromAssignments).toHaveBeenCalledWith(
      GRANT.id,
      TODAY,
      expect.anything(),
    );
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

  it("lists only the signed-in teacher's scheduled subject periods", async () => {
    const { service, repository } = createHarness({ capabilities: ['SUBJECT_ATTENDANCE'] });
    repository.findGrantAssignment.mockResolvedValue({
      ...ASSIGNMENT,
      assignment_kind: 'SUBJECT',
      subject_id: 7,
    });
    repository.listAssignmentSlotsForDate.mockResolvedValue([{ id: '12', period: 6 }]);

    await expect(
      service.listPublicAttendanceSlots(
        'valid-token-value-that-is-at-least-thirty-two-characters',
        { assignmentId: 31, date: '2026-08-04' },
      ),
    ).resolves.toEqual({ data: [{ id: 12, period: 6 }] });
    expect(repository.listAssignmentSlotsForDate).toHaveBeenCalledWith(
      { classroomId: 41, subjectId: 7, teacherMembershipId: 12, isoDayOfWeek: 2 },
      expect.anything(),
    );
  });

  it('requires the dedicated issuer permission instead of school-structure authority', async () => {
    const { service } = createHarness();

    await expect(
      service.listGrants({ schoolId: 10 }, { ...ACTOR, permissions: ['manage-school-structure'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('expires a link at the end of the term it was issued for', async () => {
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
      { ...ASSIGNMENT, effective_until: '2099-06-30' },
    ]);
    repository.createGrant.mockResolvedValue(GRANT.id);

    await service.issueGrant(
      { teacherMembershipId: 12, schoolTermId: 21 },
      ACTOR,
      'https://sts.example',
    );

    // One link per term with a fixed EMAIL_OTP step-up: no system setting is
    // read, and an assignment ending earlier does not shorten the link.
    expect(repository.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: new Date('2099-12-31T16:59:59.999Z'),
        stepUpPolicy: 'EMAIL_OTP',
      }),
      expect.anything(),
    );
  });

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

  it('issues only for the picked teachers and explains the ones it left out', async () => {
    const { service, repository } = createHarness();
    stubIssuableTerm(repository);
    repository.listMembershipsNeedingGrant.mockResolvedValue([{ teacher_membership_id: '12' }]);
    repository.describeMembershipsForGrant.mockResolvedValue([
      {
        teacher_membership_id: '13',
        is_active: true,
        assignment_count: '2',
        has_active_grant: true,
      },
      {
        teacher_membership_id: '14',
        is_active: true,
        assignment_count: '0',
        has_active_grant: false,
      },
    ]);

    const result = await service.issueGrantsForTerm(
      { schoolTermId: 21, teacherMembershipIds: [12, 13, 14] },
      ACTOR,
    );

    expect(repository.listMembershipsNeedingGrant).toHaveBeenCalledWith(
      expect.objectContaining({ teacherMembershipIds: [12, 13, 14] }),
      expect.anything(),
    );
    expect(repository.createGrant).toHaveBeenCalledTimes(1);
    expect(result.data).toEqual({
      issued: 1,
      skipped: [
        { teacherMembershipId: 13, reason: 'มีลิงก์ที่ใช้งานได้อยู่แล้ว' },
        { teacherMembershipId: 14, reason: TEACHER_ACCESS_NO_ASSIGNMENT_REASON },
      ],
    });
  });

  it('leaves the picks out of the query when the whole term is issued', async () => {
    const { service, repository } = createHarness();
    stubIssuableTerm(repository);

    await service.issueGrantsForTerm({ schoolTermId: 21 }, ACTOR);

    expect(repository.listMembershipsNeedingGrant).toHaveBeenCalledWith(
      expect.objectContaining({ teacherMembershipIds: undefined }),
      expect.anything(),
    );
    expect(repository.describeMembershipsForGrant).not.toHaveBeenCalled();
  });

  const DELIVERABLE = {
    teacher_membership_id: '12',
    teacher_id: '7',
    teacher_display_name: 'ครู หนึ่ง',
    grant_id: GRANT.id,
    grant_status: 'ACTIVE' as const,
    token_encrypted: 'v1:token-value',
    provider_user_id: 'U0000000000000000000000000000001',
    friend_state: 'FRIEND',
  };

  it('sends each teacher their own link and explains everyone it could not reach', async () => {
    const { service, repository, messaging } = createHarness();
    stubIssuableTerm(repository);
    repository.listGrantsForDelivery.mockResolvedValue([
      DELIVERABLE,
      { ...DELIVERABLE, teacher_membership_id: '13', provider_user_id: null },
      { ...DELIVERABLE, teacher_membership_id: '14', friend_state: 'NOT_FRIEND' },
      { ...DELIVERABLE, teacher_membership_id: '15', grant_status: 'REVOKED' },
      { ...DELIVERABLE, teacher_membership_id: '16', token_encrypted: null },
    ]);
    messaging.sendMessages.mockResolvedValue([
      { providerUserId: DELIVERABLE.provider_user_id, delivered: true },
    ]);

    const result = await service.sendGrantsOverMessaging(
      { schoolTermId: 21, deliveryRequestId: 'f97fe25a-38da-4f5b-a710-81c8d90bace1' },
      ACTOR,
      'https://sts.test',
    );

    // Only the reachable teacher is messaged, and each message carries that
    // teacher's own link rather than one shared body.
    expect(messaging.sendMessages).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          providerUserId: DELIVERABLE.provider_user_id,
          text: expect.stringContaining('https://sts.test') as string,
        }),
      ],
      'teacher-access-21-f97fe25a-38da-4f5b-a710-81c8d90bace1',
    );
    expect(result.data.sent).toBe(1);
    expect(result.data.skipped.map((entry) => entry.teacherMembershipId)).toEqual([13, 14, 15, 16]);
  });

  it('reports selected teachers outside the scoped term instead of dropping them silently', async () => {
    const { service, repository } = createHarness();
    stubIssuableTerm(repository);
    repository.listGrantsForDelivery.mockResolvedValue([DELIVERABLE]);

    const result = await service.sendGrantsOverMessaging(
      {
        schoolTermId: 21,
        deliveryRequestId: '243d5340-ec1e-4a81-9916-995e16e0bc77',
        teacherMembershipIds: [12, 999],
      },
      ACTOR,
      'https://sts.test',
    );

    expect(result.data.skipped).toContainEqual({
      teacherMembershipId: 999,
      reason: 'ครูไม่ได้อยู่ในโรงเรียนของภาคเรียนนี้',
    });
  });

  it('keeps the delivery result when its post-send audit cannot be written', async () => {
    const { service, repository, messaging, auditLog } = createHarness();
    stubIssuableTerm(repository);
    repository.listGrantsForDelivery.mockResolvedValue([DELIVERABLE]);
    messaging.sendMessages.mockResolvedValue([
      { providerUserId: DELIVERABLE.provider_user_id, delivered: true },
    ]);
    auditLog.record.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(
      service.sendGrantsOverMessaging(
        { schoolTermId: 21, deliveryRequestId: 'ba646258-a9e7-4e82-9f71-c361fe068b06' },
        ACTOR,
        'https://sts.test',
      ),
    ).resolves.toMatchObject({ data: { sent: 1 } });
  });

  it('marks an account unreachable when the provider refuses the delivery', async () => {
    const { service, repository, messaging, teacherMessaging } = createHarness();
    stubIssuableTerm(repository);
    repository.listGrantsForDelivery.mockResolvedValue([DELIVERABLE]);
    messaging.sendMessages.mockResolvedValue([
      {
        providerUserId: DELIVERABLE.provider_user_id,
        delivered: false,
        errorMessage: 'ผู้รับไม่ได้เป็นเพื่อน',
      },
    ]);

    const result = await service.sendGrantsOverMessaging(
      { schoolTermId: 21, deliveryRequestId: '3f06a82a-f46a-4fe5-81a8-8d9e5ae1649e' },
      ACTOR,
      'https://sts.test',
    );

    expect(result.data.sent).toBe(0);
    // The refusal is fresher than whatever the webhook last said, so it is
    // written back rather than left for the next failed send to rediscover.
    expect(teacherMessaging.markUnreachable).toHaveBeenCalledWith(DELIVERABLE.provider_user_id);
  });

  it('refuses to send while the messaging integration is off', async () => {
    const { service, messaging } = createHarness();
    messaging.isEnabled.mockReturnValue(false);

    await expect(
      service.sendGrantsOverMessaging(
        { schoolTermId: 21, deliveryRequestId: 'e1d1047e-f963-4450-a0bb-a84b0356f733' },
        ACTOR,
        'https://sts.test',
      ),
    ).rejects.toThrow('ยังไม่เปิดใช้งาน');
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

  it('creates demo attendance for the same three classroom days without overwriting real data', async () => {
    const { service, repository, attendance, risk } = createHarness();
    repository.listRosterIds.mockResolvedValue([
      'student-1',
      'student-2',
      'student-3',
      'student-4',
    ]);
    attendance.saveAttendanceWithinTransaction.mockResolvedValue({
      affectedStudentIds: ['student-1', 'student-2', 'student-3', 'student-4'],
      calendarConfigured: true,
      session: { id: 'session-1', status: 'SUBMITTED', revision: 1 },
    });

    const result = await service.seedPublicAttendanceDemo(
      'valid-token-value-that-is-at-least-thirty-two-characters',
      31,
    );

    expect(repository.hasNonDemoAttendanceSessions).toHaveBeenCalledWith(
      41,
      ['2026-08-03', '2026-08-04', '2026-08-05'],
      `TEACHER_ACCESS_DEMO:${GRANT.id}`,
      expect.anything(),
    );
    expect(attendance.saveAttendanceWithinTransaction).toHaveBeenCalledTimes(3);
    expect(attendance.saveAttendanceWithinTransaction).toHaveBeenCalledWith(
      [
        { student_id: 'student-1', status: 'P_ABSENT' },
        { student_id: 'student-2', status: 'P_ABSENT' },
        { student_id: 'student-3', status: 'P_ABSENT' },
        { student_id: 'student-4', status: 'P_PRESENT' },
      ],
      expect.objectContaining({ recorder: `TEACHER_ACCESS_DEMO:${GRANT.id}` }),
      expect.anything(),
      undefined,
      71,
      '2026-08-03',
    );
    expect(risk.enqueueStudents).toHaveBeenCalledWith(
      ['student-1', 'student-2', 'student-3', 'student-4'],
      'teacher-access-demo-absences',
    );
    expect(result.data).toEqual({
      dates: ['2026-08-03', '2026-08-04', '2026-08-05'],
      studentCount: 3,
      sessionCount: 3,
    });
  });

  it('returns demo attendance before immediate case automation finishes', async () => {
    const { service, repository, attendance, automation } = createHarness();
    repository.listRosterIds.mockResolvedValue([
      'student-1',
      'student-2',
      'student-3',
      'student-4',
    ]);
    repository.getAlertTriggerType.mockResolvedValue('IMMEDIATE');
    attendance.saveAttendanceWithinTransaction.mockResolvedValue({
      affectedStudentIds: ['student-1', 'student-2', 'student-3', 'student-4'],
      calendarConfigured: true,
      session: { id: 'session-1', status: 'SUBMITTED', revision: 1 },
    });
    let finishAutomation!: (value: unknown[]) => void;
    automation.checkConsecutiveAbsences.mockReturnValue(
      new Promise((resolve) => {
        finishAutomation = resolve;
      }),
    );

    await expect(
      service.seedPublicAttendanceDemo(
        'valid-token-value-that-is-at-least-thirty-two-characters',
        31,
      ),
    ).resolves.toMatchObject({ success: true, data: { studentCount: 3, sessionCount: 3 } });
    expect(automation.checkConsecutiveAbsences).toHaveBeenCalledTimes(1);

    finishAutomation([]);
  });

  it('clears only demo-marked sessions from the same three classroom days', async () => {
    const { service, repository } = createHarness();

    const result = await service.clearPublicAttendanceDemo(
      'valid-token-value-that-is-at-least-thirty-two-characters',
      31,
    );

    expect(repository.deleteClassroomRecentAttendance).toHaveBeenCalledWith(
      41,
      ['2026-08-03', '2026-08-04', '2026-08-05'],
      `TEACHER_ACCESS_DEMO:${GRANT.id}`,
      expect.anything(),
    );
    expect(result.data).toEqual({
      dates: ['2026-08-03', '2026-08-04', '2026-08-05'],
      deletedSessionCount: 3,
    });
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
