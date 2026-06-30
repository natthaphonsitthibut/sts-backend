import { NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AuthController } from './auth.controller';
import { SessionCookieService } from './session-cookie.service';
import { StudentAuthService } from './student-auth.service';

describe('AuthController mock ThaID login', () => {
  const user = { id: 77, username: '10010002-ABCDE' };

  it('sets the normal session cookie for the linked user', async () => {
    const studentAuthService = { loginWithMockThaId: jest.fn().mockResolvedValue(user) };
    const sessionCookieService = { setSession: jest.fn() };
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
    expect(sessionCookieService.setSession).toHaveBeenCalledWith({}, 77);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOGIN', actorUserId: 77 }),
    );
  });

  it('does not set a cookie when account linking fails', async () => {
    const studentAuthService = {
      loginWithMockThaId: jest.fn().mockRejectedValue(new NotFoundException()),
    };
    const sessionCookieService = { setSession: jest.fn() };
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
    expect(sessionCookieService.setSession).not.toHaveBeenCalled();
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'LOGIN_FAILED', actorLabel: 'THAID_MOCK' }),
    );
  });
});
