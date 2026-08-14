import type { AuthRuntimeConfig } from '../config/auth.config';
import type { EmailRuntimeConfig } from '../config/email.config';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EmailService } from '../common/email/email.service';
import { MagicSessionStoreService } from '../auth/magic-session-store.service';
import { TaskAccessService } from './task-access.service';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';

describe('TaskAccessService login-link usage', () => {
  let service: TaskAccessService;
  let taskRepository: jest.Mocked<Pick<TaskRepository, 'markLoginLinkUsed'>>;
  let taskPolicyService: jest.Mocked<
    Pick<
      TaskPolicyService,
      'getRoleMap' | 'resolveEffectivePermissions' | 'normalizeScope' | 'getRoleLabel'
    >
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'record'>>;
  let magicSessionStore: jest.Mocked<Pick<MagicSessionStoreService, 'issue' | 'isVerified'>>;

  beforeEach(() => {
    taskRepository = {
      markLoginLinkUsed: jest.fn().mockResolvedValue(undefined),
    };
    taskPolicyService = {
      getRoleMap: jest.fn().mockResolvedValue(new Map()),
      resolveEffectivePermissions: jest.fn().mockReturnValue(['home']),
      normalizeScope: jest.fn().mockReturnValue({
        global: false,
        provinces: [],
        districts: [],
        sub_districts: [],
        school_ids: ['10010002'],
        grade_levels: [],
        room_ids: [],
        own_only: false,
      }),
      getRoleLabel: jest.fn().mockReturnValue('คุณครู'),
    };
    auditLog = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    magicSessionStore = {
      issue: jest.fn().mockResolvedValue('session-token'),
      isVerified: jest.fn().mockResolvedValue(false),
    };

    service = new TaskAccessService(
      taskRepository as unknown as TaskRepository,
      taskPolicyService as unknown as TaskPolicyService,
      {} as EmailService,
      auditLog as unknown as AuditLogService,
      {
        sessionSecret: 'test-session-secret-at-least-16-chars',
        magicSessionTtlSeconds: 21_600,
      } as AuthRuntimeConfig,
      { enabled: false, user: '' } as EmailRuntimeConfig,
      magicSessionStore as unknown as MagicSessionStoreService,
    );
  });

  it('does not mark the link used while OTP verification is pending', async () => {
    jest.spyOn(service, 'getTaskByToken').mockResolvedValue({
      task_type: 'LOGIN',
      auth_required: true,
      assigned_to_email: 'teacher@example.test',
      assigned_to_name: 'ครูทดสอบ',
      expires_at: '2026-07-01T00:00:00.000Z',
    });

    await expect(service.verifyMagicLogin('public-token')).resolves.toMatchObject({
      otp_required: true,
    });
    expect(taskRepository.markLoginLinkUsed).not.toHaveBeenCalled();
  });

  it('records the first successful login without consuming the reusable link', async () => {
    jest.spyOn(service, 'getTaskByToken').mockResolvedValue({
      link_id: 'seed-link-login-1',
      task_type: 'LOGIN',
      auth_required: false,
      assigned_to_email: 'teacher@example.test',
      assigned_to_name: 'ครูทดสอบ',
      login_role: 'TEACHER',
      login_permissions: ['home'],
      login_data_scope: { school_ids: ['10010002'] },
    });

    await expect(service.verifyMagicLogin('public-token')).resolves.toMatchObject({
      username: 'teacher@example.test',
      virtual_login: true,
    });
    expect(taskRepository.markLoginLinkUsed).toHaveBeenCalledWith('seed-link-login-1');
  });
});

describe('TaskAccessService.getAdminLinkDetail own_only VISIT reviewer access', () => {
  let service: TaskAccessService;
  let taskRepository: jest.Mocked<Pick<TaskRepository, 'findLinkDetailById'>>;
  let taskPolicyService: TaskPolicyService;

  const ownOnlyReviewer = {
    id: 42,
    username: 'reviewer@example.test',
    roles: ['REVIEWER'],
    permissions: ['review-cases'],
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
      {} as EmailService,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService,
      {
        sessionSecret: 'test-session-secret-at-least-16-chars',
        magicSessionTtlSeconds: 21_600,
      } as AuthRuntimeConfig,
      { enabled: false, user: '' } as EmailRuntimeConfig,
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
      {} as EmailService,
      {} as AuditLogService,
      {
        sessionSecret: 'test-session-secret-at-least-16-chars',
        magicSessionTtlSeconds: 21_600,
      } as AuthRuntimeConfig,
      { enabled: false, user: '' } as EmailRuntimeConfig,
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
      otp_verified: 1,
      delegation_depth: 0,
      max_delegation_depth: 0,
    });

    await expect(service.getTaskByToken('public-token')).resolves.toMatchObject({
      status: 'SCHEDULED',
    });
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
    >
  >;
  let magicSessionStore: jest.Mocked<Pick<MagicSessionStoreService, 'isVerified'>>;

  function createService(emailEnabled: boolean): TaskAccessService {
    return new TaskAccessService(
      taskRepository as unknown as TaskRepository,
      {} as TaskPolicyService,
      {} as EmailService,
      {} as AuditLogService,
      {
        sessionSecret: 'test-session-secret-at-least-16-chars',
        magicSessionTtlSeconds: 21_600,
      } as AuthRuntimeConfig,
      {
        enabled: emailEnabled,
        user: emailEnabled ? 'sender@example.test' : '',
      } as EmailRuntimeConfig,
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
        otp_verified: 0,
        delegation_depth: 0,
        max_delegation_depth: 0,
        assigned_to_name: 'ครูเยี่ยมบ้าน',
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
    };
    magicSessionStore = {
      isVerified: jest.fn().mockResolvedValue(false),
    };
  });

  it('returns class, structured address, and bounded history after the guest is authorized', async () => {
    await expect(createService(false).getTaskByToken('public-token')).resolves.toMatchObject({
      student_name: 'เด็กหญิงทดสอบ',
      academic_year: 2569,
      semester: 1,
      student_grade: 'ม.3',
      student_room: '2',
      case_status: 'IN_PROGRESS',
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
    });
    expect(taskRepository.listPublicCaseFollowUpHistory).toHaveBeenCalledWith(88, 5);
  });

  it('does not expose report history before OTP verification', async () => {
    const result = await createService(true).getTaskByToken('public-token');

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
  });
});

describe('TaskAccessService OTP sessions', () => {
  let service: TaskAccessService;
  let taskRepository: jest.Mocked<
    Pick<TaskRepository, 'withTransaction' | 'findOtpLinkByTokenHashForUpdate' | 'clearOtpAttempts'>
  >;
  let magicSessionStore: jest.Mocked<Pick<MagicSessionStoreService, 'issue' | 'isVerified'>>;

  beforeEach(() => {
    taskRepository = {
      withTransaction: jest.fn(
        async (callback: (executor: unknown) => Promise<unknown>) => await callback({}),
      ),
      findOtpLinkByTokenHashForUpdate: jest.fn().mockResolvedValue({
        id: 'link-1',
        otp_code: '123456',
        otp_expires_at: '2999-01-01T00:00:00.000Z',
        otp_locked_until: null,
      }),
      clearOtpAttempts: jest.fn().mockResolvedValue(undefined),
    };
    magicSessionStore = {
      issue: jest.fn().mockResolvedValue('stored-session-token'),
      isVerified: jest.fn().mockResolvedValue(false),
    };

    service = new TaskAccessService(
      taskRepository as unknown as TaskRepository,
      {} as TaskPolicyService,
      {} as EmailService,
      {} as AuditLogService,
      {
        sessionSecret: 'test-session-secret-at-least-16-chars',
        magicSessionTtlSeconds: 21_600,
        otpTtlSeconds: 600,
        otpMaxAttempts: 5,
        otpLockSeconds: 900,
      } as AuthRuntimeConfig,
      { enabled: false, user: '' } as EmailRuntimeConfig,
      magicSessionStore as unknown as MagicSessionStoreService,
    );
  });

  it('issues the verified magic session through the shared store', async () => {
    await expect(service.verifyOtp('public-token', '123456')).resolves.toEqual({
      success: true,
      session_token: 'stored-session-token',
    });
    expect(taskRepository.clearOtpAttempts).toHaveBeenCalledWith('link-1', {});
    expect(magicSessionStore.issue).toHaveBeenCalledWith('link-1');
  });
});

describe('TaskAccessService OTP challenge', () => {
  it('returns only a masked destination after issuing an OTP', async () => {
    const taskRepository = {
      findOtpLinkByTokenHash: jest.fn().mockResolvedValue({
        id: 'link-1',
        assigned_to_email: 'teacher@example.test',
      }),
      updateLinkOtp: jest.fn().mockResolvedValue(undefined),
    };
    const emailService = { sendOTP: jest.fn().mockResolvedValue(undefined) };
    const service = new TaskAccessService(
      taskRepository as unknown as TaskRepository,
      {} as TaskPolicyService,
      emailService as unknown as EmailService,
      {} as AuditLogService,
      {
        sessionSecret: 'test-session-secret-at-least-16-chars',
        magicSessionTtlSeconds: 21_600,
        otpTtlSeconds: 600,
      } as AuthRuntimeConfig,
      { enabled: true, user: 'mailer@example.test' } as EmailRuntimeConfig,
      {} as MagicSessionStoreService,
    );

    const result = await service.requestOtp('public-token');

    expect(result).toMatchObject({
      success: true,
      method: 'EMAIL',
      maskedEmail: 'te*****@example.test',
    });
    expect(JSON.stringify(result)).not.toContain('teacher@example.test');
    expect(emailService.sendOTP).toHaveBeenCalledWith(
      'teacher@example.test',
      expect.any(String),
      10,
    );
  });
});

describe('TaskAccessService admin link audit', () => {
  const actor = {
    id: 53,
    username: 'admin53',
    roles: ['ADMIN'],
    permissions: ['attendance-dashboard'],
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
      {} as EmailService,
      auditLog as unknown as AuditLogService,
      {
        sessionSecret: 'test-session-secret-at-least-16-chars',
        magicSessionTtlSeconds: 21_600,
      } as AuthRuntimeConfig,
      { enabled: false, user: '' } as EmailRuntimeConfig,
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
