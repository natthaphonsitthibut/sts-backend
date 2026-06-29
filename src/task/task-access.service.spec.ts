import type { AuthRuntimeConfig } from '../config/auth.config';
import type { EmailRuntimeConfig } from '../config/email.config';
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

    service = new TaskAccessService(
      taskRepository as unknown as TaskRepository,
      taskPolicyService as unknown as TaskPolicyService,
      {} as EmailService,
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
