import { ForbiddenException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { MagicSessionStoreService } from '../auth/magic-session-store.service';
import { TaskAccessService } from './task-access.service';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';

describe('TaskAccessService.getAdminLinkDetail own_only VISIT reviewer access', () => {
  let service: TaskAccessService;
  let taskRepository: jest.Mocked<Pick<TaskRepository, 'findLinkDetailById'>>;
  let taskPolicyService: TaskPolicyService;

  const ownOnlyReviewer = {
    id: 42,
    username: 'reviewer@example.test',
    roles: ['REVIEWER'],
    permissions: ['dashboard'],
    data_scope: { own_only: true },
  };

  const baseVisitLink = {
    id: 'link-visit-1',
    task_id: 'task-1',
    task_type: 'VISIT',
    login_role: null,
    login_data_scope: {},
    target_school_id: 10010002,
    target_room: '1',
    expires_at: '2999-01-01T00:00:00.000Z',
    admin_locked: 0,
    opens_at: null,
  };

  beforeEach(() => {
    taskRepository = {
      findLinkDetailById: jest.fn(),
    };
    // Real TaskPolicyService (not mocked) so canManageAdminLink's own_only
    // branch actually runs — a mocked policy would hide the getAdminLinkDetail
    // -> canManageAdminLink wiring bug this test guards against.
    taskPolicyService = new TaskPolicyService({
      getRoleDefinitions: jest.fn().mockResolvedValue([]),
    } as unknown as TaskRepository);

    service = new TaskAccessService(
      taskRepository as unknown as TaskRepository,
      taskPolicyService,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService,
      {} as MagicSessionStoreService,
    );
  });

  it('lets an own_only reviewer view a VISIT link on their own case', async () => {
    taskRepository.findLinkDetailById.mockResolvedValue({
      ...baseVisitLink,
      case_created_by: ownOnlyReviewer.id,
    });

    await expect(
      service.getAdminLinkDetail(ownOnlyReviewer, 'link-visit-1'),
    ).resolves.toMatchObject({ link_id: 'link-visit-1' });
  });

  it("blocks an own_only reviewer from viewing a VISIT link on someone else's case", async () => {
    taskRepository.findLinkDetailById.mockResolvedValue({
      ...baseVisitLink,
      case_created_by: 999,
    });

    await expect(service.getAdminLinkDetail(ownOnlyReviewer, 'link-visit-1')).rejects.toThrow(
      'ไม่มีสิทธิ์ดูลิงก์นี้',
    );
  });
});

describe('TaskAccessService scheduled link access', () => {
  let service: TaskAccessService;
  let taskRepository: jest.Mocked<Pick<TaskRepository, 'findTaskLinkByTokenHash'>>;

  beforeEach(() => {
    taskRepository = {
      findTaskLinkByTokenHash: jest.fn(),
    };

    service = new TaskAccessService(
      taskRepository as unknown as TaskRepository,
      {} as TaskPolicyService,
      {} as AuditLogService,
      {
        issue: jest.fn().mockResolvedValue('session-token'),
        isVerified: jest.fn().mockResolvedValue(false),
      } as unknown as MagicSessionStoreService,
    );
  });

  it('refuses a link whose opens_at is still in the future (SCHEDULED, no access)', async () => {
    taskRepository.findTaskLinkByTokenHash.mockResolvedValue({
      id: 'link-1',
      task_id: 'task-1',
      task_type: 'VISIT',
      status: 'ACTIVE',
      expires_at: '2999-01-01T00:00:00.000Z',
      opens_at: '2999-01-01T00:00:00.000Z',
      admin_locked: 0,
      delegation_depth: 0,
      max_delegation_depth: 0,
    });

    await expect(service.getTaskByToken('public-token')).resolves.toMatchObject({
      status: 'SCHEDULED',
    });
  });
});

describe('TaskAccessService public link identity providers', () => {
  const LINK = {
    id: '10000000-0000-4000-8000-000000000001',
    task_id: '20000000-0000-4000-8000-000000000002',
    task_type: 'VISIT',
    status: 'ACTIVE',
    target_school_id: 10010002,
    assigned_teacher_id: 42,
    expires_at: '2999-01-01T00:00:00.000Z',
    opens_at: null,
    admin_locked: 0,
  };

  function createIdentityHarness() {
    const taskRepository = {
      findTaskLinkByTokenHash: jest.fn().mockResolvedValue(LINK),
      findActiveTeacherInSchoolByEmail: jest
        .fn()
        .mockResolvedValue({ teacher_id: '99', email: 'other-teacher@school.test' }),
      findTaskLinkAraIdIdentity: jest
        .fn()
        .mockResolvedValue({ target_school_id: LINK.target_school_id }),
      findActiveTeacherInSchoolByCitizenId: jest.fn().mockResolvedValue({ teacher_id: '99' }),
    };
    const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    const magicSessionStore = {
      issue: jest.fn().mockResolvedValue('verified-session'),
      isVerified: jest.fn().mockResolvedValue(false),
    };
    const araIdChallengeStore = {
      readAuthorization: jest.fn().mockResolvedValue({
        minimumAuthenticatedAt: 1_000,
        challenge: { subjectId: LINK.id },
      }),
      approveAuthorization: jest.fn().mockResolvedValue(true),
    };
    const araIdService = {
      getVerifiedIdentityNumber: jest.fn().mockResolvedValue('1101700200018'),
    };
    const google = {
      authorizationUrl: jest.fn().mockReturnValue('https://accounts.google.test/authorize'),
      exchange: jest.fn().mockResolvedValue({
        subject: 'google-subject',
        email: 'other-teacher@school.test',
        persistIdentity: true,
      }),
      developmentIdentity: jest.fn().mockReturnValue({
        subject: 'sts-local-development',
        email: 'other-teacher@school.test',
        persistIdentity: false,
      }),
    };
    const googleStates = {
      create: jest.fn().mockResolvedValue({ state: 'google-state', nonce: 'google-nonce' }),
      consume: jest.fn().mockResolvedValue({
        flow: 'task-link',
        subjectId: LINK.id,
        tokenHash: 'stored-token-hash',
        schoolId: LINK.target_school_id,
        nonce: 'google-nonce',
      }),
    };
    const service = new TaskAccessService(
      taskRepository as unknown as TaskRepository,
      {} as TaskPolicyService,
      auditLog as unknown as AuditLogService,
      magicSessionStore as unknown as MagicSessionStoreService,
      araIdChallengeStore as never,
      araIdService as never,
      google as never,
      googleStates as never,
      { taskCallbackUrl: 'https://api.sts.test/api/tasks/google/callback' } as never,
    );
    return {
      service,
      taskRepository,
      auditLog,
      magicSessionStore,
      araIdChallengeStore,
      araIdService,
      google,
      googleStates,
    };
  }

  it('starts Google Login with state scoped to the link school', async () => {
    const { service, google, googleStates } = createIdentityHarness();

    await expect(service.startGoogleAuthorization('x'.repeat(64))).resolves.toEqual({
      authorizationUrl: 'https://accounts.google.test/authorize',
    });
    expect(googleStates.create).toHaveBeenCalledWith(
      'task-link',
      expect.objectContaining({ subjectId: LINK.id, schoolId: LINK.target_school_id }),
    );
    expect(google.authorizationUrl).toHaveBeenCalledWith(
      'google-state',
      'google-nonce',
      'https://api.sts.test/api/tasks/google/callback',
    );
  });

  it('lets any active teacher in the link school verify with Google', async () => {
    const { service, taskRepository, magicSessionStore } = createIdentityHarness();

    await expect(service.completeGoogleAuthorization('google-code', 'google-state')).resolves.toBe(
      'verified-session',
    );
    expect(taskRepository.findActiveTeacherInSchoolByEmail).toHaveBeenCalledWith(
      'other-teacher@school.test',
      LINK.target_school_id,
    );
    expect(magicSessionStore.issue).toHaveBeenCalledWith(LINK.id);
  });

  it('lets an entered local email resolve only to an active teacher in the link school', async () => {
    const { service, google, taskRepository, magicSessionStore } = createIdentityHarness();

    await expect(
      service.completeDevelopmentGoogleAuthorization('x'.repeat(64), ' Teacher@School.test '),
    ).resolves.toBe('verified-session');

    expect(google.developmentIdentity).toHaveBeenCalledWith(' Teacher@School.test ');
    expect(taskRepository.findActiveTeacherInSchoolByEmail).toHaveBeenCalledWith(
      'other-teacher@school.test',
      LINK.target_school_id,
    );
    expect(magicSessionStore.issue).toHaveBeenCalledWith(LINK.id);
  });

  it('rejects an entered local email outside the task link school', async () => {
    const { service, taskRepository } = createIdentityHarness();
    taskRepository.findActiveTeacherInSchoolByEmail.mockResolvedValue(null);

    try {
      await service.completeDevelopmentGoogleAuthorization('x'.repeat(64), 'outside@example.com');
      throw new Error('expected local Google verification to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
    }
  });

  it('lets any active teacher in the link school approve with AraID', async () => {
    const { service, taskRepository, araIdChallengeStore } = createIdentityHarness();

    await expect(
      service.approveTaskAraIdChallenge('authorization-token', 'araid-profile', 1_000),
    ).resolves.toEqual({ success: true, data: { approved: true } });
    expect(taskRepository.findActiveTeacherInSchoolByCitizenId).toHaveBeenCalledWith(
      '1101700200018',
      LINK.target_school_id,
    );
    expect(araIdChallengeStore.approveAuthorization).toHaveBeenCalled();
  });
});

describe('TaskAccessService home visit report context', () => {
  let taskRepository: jest.Mocked<
    Pick<
      TaskRepository,
      | 'findTaskLinkByTokenHash'
      | 'findCaseByTaskId'
      | 'listPublicCaseContactChannels'
      | 'listPublicCaseFollowUpHistory'
      | 'findRepeatVisitPrefill'
    >
  >;
  let magicSessionStore: jest.Mocked<Pick<MagicSessionStoreService, 'isVerified'>>;

  function createService(): TaskAccessService {
    return new TaskAccessService(
      taskRepository as unknown as TaskRepository,
      {} as TaskPolicyService,
      {} as AuditLogService,
      magicSessionStore as unknown as MagicSessionStoreService,
    );
  }

  beforeEach(() => {
    taskRepository = {
      findTaskLinkByTokenHash: jest.fn().mockResolvedValue({
        id: 'visit-link-1',
        task_id: 'visit-task-1',
        task_type: 'VISIT',
        status: 'ACTIVE',
        expires_at: '2999-01-01T00:00:00.000Z',
        admin_locked: 0,
        delegation_depth: 0,
        max_delegation_depth: 0,
        assigned_to_name: 'ครูเยี่ยมบ้าน',
        current_assignee_name: 'ครูชื่อปัจจุบัน',
        assigned_to_email: 'visitor@example.test',
      }),
      findCaseByTaskId: jest.fn().mockResolvedValue({
        id: 88,
        student_name: 'เด็กหญิงทดสอบ',
        student_school: 'โรงเรียนทดสอบ',
        student_address: '99 ถนนทดสอบ',
        student_phone: '0812345678',
        address_province: 'กรุงเทพมหานคร',
        address_district: 'ดุสิต',
        address_sub_district: 'ดุสิต',
        postal_code: '10300',
        reason_flagged: 'ขาดเรียนต่อเนื่อง',
        status: 'IN_PROGRESS',
        display_status_label: 'รอติดตาม : ติดตาม',
        academic_year: 2569,
        semester: 1,
        grade: 'ม.3',
        room: '2',
      }),
      listPublicCaseContactChannels: jest.fn().mockResolvedValue([
        {
          contact_kind: 'STUDENT',
          relation: 'STUDENT',
          relation_note: null,
          full_name: 'เด็กหญิงทดสอบ',
          phone: '0812345678',
          is_primary: true,
        },
        {
          contact_kind: 'GUARDIAN',
          relation: 'MOTHER',
          relation_note: null,
          full_name: 'มารดาทดสอบ',
          phone: '0899999999',
          is_primary: true,
        },
      ]),
      listPublicCaseFollowUpHistory: jest.fn().mockResolvedValue([
        {
          assigned_to_name: 'ครูคนก่อน',
          visited_at: '2026-06-13T09:00:00.000Z',
          submitted_at: '2026-06-13T10:00:00.000Z',
          cause_detail: 'ลงพื้นที่แล้ว',
          exception_label: null,
        },
      ]),
      findRepeatVisitPrefill: jest.fn().mockResolvedValue({
        source_submission_id: 71,
        source_round_number: 2,
        source_submitted_at: '2026-06-13T10:00:00.000Z',
        parental_status_code: 'TOGETHER',
        guardian_type_code: 'MOTHER',
        guardian_type_detail: null,
        contact_person_name: 'มารดาทดสอบ',
        contact_channel_code: 'PHONE',
        residence_environment_codes: ['NORMAL'],
        residence_environment_detail: null,
      }),
    };
    magicSessionStore = {
      isVerified: jest.fn().mockResolvedValue(false),
    };
  });

  it('returns class, structured address, and bounded history after the guest is authorized', async () => {
    // Authorisation is a verified, link-scoped session. The session alone opens
    // the protected student context regardless of which provider issued it.
    magicSessionStore.isVerified.mockResolvedValue(true);
    await expect(
      createService().getTaskByToken('public-token', 'verified-session'),
    ).resolves.toMatchObject({
      student_name: 'เด็กหญิงทดสอบ',
      academic_year: 2569,
      semester: 1,
      student_grade: 'ม.3',
      student_room: '2',
      case_status: 'IN_PROGRESS',
      case_display_status_label: 'รอติดตาม : ติดตาม',
      assigned_to_name: 'ครูชื่อปัจจุบัน',
      address_province: 'กรุงเทพมหานคร',
      contact_channels: [
        {
          contact_kind: 'STUDENT',
          phone: '0812345678',
        },
        {
          contact_kind: 'GUARDIAN',
          phone: '0899999999',
        },
      ],
      follow_up_history: [
        {
          assigned_to_name: 'ครูคนก่อน',
          cause_detail: 'ลงพื้นที่แล้ว',
        },
      ],
      prefill: {
        source_submission_id: 71,
        source_round_number: 2,
        parental_status_code: 'TOGETHER',
        contact_person_name: 'มารดาทดสอบ',
        residence_environment_codes: ['NORMAL'],
      },
    });
    expect(taskRepository.listPublicCaseFollowUpHistory).toHaveBeenCalledWith(88, 5);
  });

  it('does not expose report history before identity verification', async () => {
    const result = await createService().getTaskByToken('public-token');

    expect(result).toMatchObject({
      auth_required: true,
      student_address: '*** (กรุณายืนยันตัวตน) ***',
      reason_flagged: '*** (กรุณายืนยันตัวตน) ***',
    });
    expect(result).not.toHaveProperty('follow_up_history');
    expect(result).not.toHaveProperty('contact_channels');
    expect(result).not.toHaveProperty('case_status');
    expect(taskRepository.listPublicCaseContactChannels).not.toHaveBeenCalled();
    expect(taskRepository.listPublicCaseFollowUpHistory).not.toHaveBeenCalled();
    expect(taskRepository.findRepeatVisitPrefill).not.toHaveBeenCalled();
  });

  it('gates an assistance link behind identity verification like a follow-up link', async () => {
    taskRepository.findTaskLinkByTokenHash.mockResolvedValue({
      id: 'assist-link-1',
      task_id: 'assist-task-1',
      task_type: 'ASSIST',
      status: 'ACTIVE',
      expires_at: '2999-01-01T00:00:00.000Z',
      admin_locked: 0,
      assigned_to_name: 'ครูผู้ช่วยเหลือ',
      assigned_to_email: 'teacher@example.test',
    });
    taskRepository.listTaskAssistanceMeasures = jest.fn().mockResolvedValue([]);

    await expect(createService().getTaskByToken('public-token')).resolves.toMatchObject({
      task_type: 'ASSIST',
      auth_required: true,
    });
    // The student context must stay masked until the teacher verifies.
    expect(taskRepository.listPublicCaseContactChannels).not.toHaveBeenCalled();
  });

  it('always demands identity before exposing protected student data', async () => {
    const result = await createService().getTaskByToken('public-token');

    expect(result).toMatchObject({
      auth_required: true,
      student_address: '*** (กรุณายืนยันตัวตน) ***',
    });
    expect(result).not.toHaveProperty('contact_channels');
  });

  it('still demands identity when the link has no email address on file', async () => {
    taskRepository.findTaskLinkByTokenHash.mockResolvedValue({
      id: 'visit-link-1',
      task_id: 'visit-task-1',
      task_type: 'VISIT',
      status: 'ACTIVE',
      expires_at: '2999-01-01T00:00:00.000Z',
      admin_locked: 0,
      assigned_to_name: 'ครูไม่มีอีเมล',
      assigned_to_email: null,
    });

    await expect(createService().getTaskByToken('public-token')).resolves.toMatchObject({
      auth_required: true,
    });
  });
});

describe('TaskAccessService admin link audit', () => {
  const actor = {
    id: 53,
    username: 'admin53',
    roles: ['ADMIN'],
    permissions: ['dashboard'],
    data_scope: { school_ids: [10010002] },
  };
  let service: TaskAccessService;
  let taskRepository: jest.Mocked<
    Pick<TaskRepository, 'findTaskLinkById' | 'updateAdminLockState'>
  >;
  let taskPolicyService: jest.Mocked<
    Pick<TaskPolicyService, 'ensureActor' | 'getRoleMap' | 'canManageAdminLink'>
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;

  beforeEach(() => {
    taskRepository = {
      findTaskLinkById: jest.fn().mockResolvedValue({
        id: 'link-1',
        task_id: 'task-1',
        task_type: 'VISIT',
        status: 'ACTIVE',
        login_role: null,
        login_data_scope: null,
        target_school_id: 10010002,
        target_grade: 'ม.6',
        target_room: '1',
      }),
      updateAdminLockState: jest.fn().mockResolvedValue(undefined),
    };
    taskPolicyService = {
      ensureActor: jest.fn().mockReturnValue(actor),
      getRoleMap: jest.fn().mockResolvedValue(new Map()),
      canManageAdminLink: jest.fn().mockReturnValue(true),
    };
    auditLog = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    service = new TaskAccessService(
      taskRepository as unknown as TaskRepository,
      taskPolicyService as unknown as TaskPolicyService,
      auditLog as unknown as AuditLogService,
      {
        issue: jest.fn().mockResolvedValue('session-token'),
        isVerified: jest.fn().mockResolvedValue(false),
      } as unknown as MagicSessionStoreService,
    );
  });

  it('records link lock audit metadata after updating the link', async () => {
    await expect(service.adminLockLink(actor, 'link-1', 'lock', 'ปิดชั่วคราว')).resolves.toEqual({
      message: 'Link locked by admin',
      link_id: 'link-1',
      admin_locked: 1,
    });

    expect(taskRepository.updateAdminLockState).toHaveBeenCalledWith(
      expect.objectContaining({ linkId: 'link-1', locked: true, reason: 'ปิดชั่วคราว' }),
    );
    const auditEvent = auditLog.record.mock.calls[0]?.[0];
    expect(auditEvent).toMatchObject({
      action: 'LINK_LOCK',
      actorUserId: 53,
      actorLabel: 'admin53',
      targetType: 'task_link',
      targetId: 'link-1',
    });
    expect(auditEvent?.metadata).toMatchObject({
      taskType: 'VISIT',
      schoolId: 10010002,
      grade: 'ม.6',
      room: '1',
      reason: 'ปิดชั่วคราว',
    });
  });

  it('records link unlock audit metadata after updating the link', async () => {
    await expect(service.adminLockLink(actor, 'link-1', 'unlock')).resolves.toEqual({
      message: 'Link unlocked by admin',
      link_id: 'link-1',
      admin_locked: 0,
    });

    expect(taskRepository.updateAdminLockState).toHaveBeenCalledWith({
      linkId: 'link-1',
      locked: false,
    });
    const auditEvent = auditLog.record.mock.calls[0]?.[0];
    expect(auditEvent).toMatchObject({
      action: 'LINK_UNLOCK',
      actorUserId: 53,
      actorLabel: 'admin53',
      targetType: 'task_link',
      targetId: 'link-1',
    });
    expect(auditEvent?.metadata).toMatchObject({
      taskType: 'VISIT',
      schoolId: 10010002,
      grade: 'ม.6',
      room: '1',
    });
  });
});
