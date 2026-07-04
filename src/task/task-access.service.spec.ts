import type { AuthRuntimeConfig } from '../config/auth.config';
import type { EmailRuntimeConfig } from '../config/email.config';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EmailService } from './email.service';
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
        task_type: 'ATTENDANCE',
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
      taskType: 'ATTENDANCE',
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
      taskType: 'ATTENDANCE',
      schoolId: 10010002,
      grade: 'ม.6',
      room: '1',
    });
  });
});
