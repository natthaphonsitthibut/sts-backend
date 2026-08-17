import { AuditLogService } from '../audit-log/audit-log.service';
import { AraIdSessionCookieService } from '../araid/araid-session-cookie.service';
import { AuthController } from './auth.controller';
import { AraIdLoginService } from './araid-login.service';
import { SessionCookieService } from './session-cookie.service';

describe('AuthController AraID login', () => {
  function buildController(overrides: Partial<Record<string, jest.Mock>> = {}) {
    const araIdLoginService = {
      createChallenge: jest.fn(),
      beginChallenge: jest.fn(),
      approveChallenge: jest.fn(),
      pollChallenge: jest.fn(),
      ...overrides.araIdLoginService,
    };
    const araIdSessionCookie = {
      readSessionIdentity: jest.fn(),
      readAdminLoginAuthorization: jest.fn(),
      setAdminLoginAuthorization: jest.fn(),
      clearAdminLoginAuthorization: jest.fn(),
      ...overrides.araIdSessionCookie,
    };
    const sessionCookieService = { setSession: jest.fn(), ...overrides.sessionCookieService };
    const auditLog = { record: jest.fn().mockResolvedValue(undefined), ...overrides.auditLog };
    const controller = new AuthController(
      araIdLoginService as unknown as AraIdLoginService,
      araIdSessionCookie as unknown as AraIdSessionCookieService,
      sessionCookieService as unknown as SessionCookieService,
      auditLog as unknown as AuditLogService,
      { frontendBaseUrl: 'http://frontend.test' } as never,
    );
    return { controller, araIdLoginService, araIdSessionCookie, sessionCookieService, auditLog };
  }

  it('creates a QR challenge using the configured frontend origin', async () => {
    const { controller, araIdLoginService } = buildController();
    araIdLoginService.createChallenge.mockResolvedValue({ challengeToken: 'challenge' });

    await expect(
      controller.createAraIdChallenge({ protocol: 'http', get: jest.fn() } as never),
    ).resolves.toEqual({ success: true, data: { challengeToken: 'challenge' } });
    expect(araIdLoginService.createChallenge).toHaveBeenCalledWith('http://frontend.test');
  });

  it('issues the normal STS session only after an approved AraID challenge', async () => {
    const { controller, araIdLoginService, sessionCookieService, auditLog } = buildController();
    araIdLoginService.pollChallenge.mockResolvedValue({ status: 'APPROVED', userId: 42 });

    await expect(
      controller.pollAraIdChallenge('challenge', { ip: '127.0.0.1' } as never, {} as never),
    ).resolves.toEqual({ success: true, data: { status: 'APPROVED' } });
    expect(sessionCookieService.setSession).toHaveBeenCalledWith({}, 42);
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LOGIN',
        actorUserId: 42,
        metadata: { authMethod: 'ARAID_QR' },
      }),
    );
  });
});
