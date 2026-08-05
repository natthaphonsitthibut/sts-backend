import { NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthController } from './auth.controller';
import { SessionCookieService } from './session-cookie.service';
import { StudentAuthService } from './student-auth.service';

describe('AuthController mock ThaID login', () => {
  const user = { id: 77, username: '10010002-ABCDE' };

  it('clears a staff cookie and returns the virtual session without a user FK', async () => {
    const studentAuthService = { loginWithMockThaId: jest.fn().mockResolvedValue(user) };
    const sessionCookieService = { clearSession: jest.fn() };
    const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new AuthController(
      studentAuthService as unknown as StudentAuthService,
      sessionCookieService as unknown as SessionCookieService,
      auditLog as unknown as AuditLogService,
    );

    await expect(
      controller.loginWithMockThaId(
        { personId: '1234567890123' },
        { ip: '127.0.0.1' } as never,
        {} as never,
      ),
    ).resolves.toBe(user);
    expect(sessionCookieService.clearSession).toHaveBeenCalledWith({});
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LOGIN',
        actorUserId: null,
        actorLabel: 'THAID_MOCK_STUDENT',
      }),
    );
  });

  it('does not set a cookie when account linking fails', async () => {
    const studentAuthService = {
      loginWithMockThaId: jest.fn().mockRejectedValue(new NotFoundException()),
    };
    const sessionCookieService = { clearSession: jest.fn() };
    const auditLog = { record: jest.fn().mockResolvedValue(undefined) };
    const controller = new AuthController(
      studentAuthService as unknown as StudentAuthService,
      sessionCookieService as unknown as SessionCookieService,
      auditLog as unknown as AuditLogService,
    );

    await expect(
      controller.loginWithMockThaId(
        { personId: '1234567890123' },
        { ip: '127.0.0.1' } as never,
        {} as never,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(sessionCookieService.clearSession).not.toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOGIN_FAILED', actorLabel: 'THAID_MOCK' }),
    );
  });
});
