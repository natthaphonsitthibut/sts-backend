import { JwtService } from '@nestjs/jwt';
import type { ConfigType } from '@nestjs/config';
import type { Response } from 'express';
import { authConfig } from '../config/auth.config';
import { AraIdSessionCookieService } from './araid-session-cookie.service';

describe('AraIdSessionCookieService', () => {
  const config: ConfigType<typeof authConfig> = {
    jwtSecret: 'JWT_SECRET_PLACEHOLDER_32_CHARS',
    sessionSecret: 'SESSION_SECRET_PLACEHOLDER_32_CHARS',
    magicSessionTtlSeconds: 21_600,
    otpTtlSeconds: 600,
    otpMaxAttempts: 5,
    otpLockSeconds: 900,
    cookieName: 'sts_session',
    cookieSecure: false,
    cookieSameSite: 'lax',
    tokenTtlSeconds: 43_200,
    thaidMode: 'mock',
  };
  const jwtService = new JwtService({
    secret: config.jwtSecret,
    signOptions: { expiresIn: config.tokenTtlSeconds },
  });
  const service = new AraIdSessionCookieService(jwtService, config);

  it('sets an isolated httpOnly cookie and resolves its AraID profile id', () => {
    const cookie = jest.fn<void, [string, string, Record<string, unknown>]>();
    const response = { cookie } as unknown as Response;
    const profileId = '11111111-1111-4111-8111-111111111111';

    service.setSession(response, profileId);

    expect(cookie).toHaveBeenCalledWith(
      'araid_session',
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 43_200_000,
        path: '/',
      }),
    );
    const token = cookie.mock.calls[0][1];
    expect(
      service.readProfileId(`unrelated=value; araid_session=${encodeURIComponent(token)}`),
    ).toBe(profileId);
    const identity = service.readSessionIdentity(`araid_session=${encodeURIComponent(token)}`);
    expect(identity).not.toBeNull();
    expect(identity?.profileId).toBe(profileId);
    expect(identity?.authenticatedAt).toBeGreaterThan(0);
  });

  it('rejects a valid JWT that was not issued for an AraID session', () => {
    const token = jwtService.sign({ sub: '11111111-1111-4111-8111-111111111111' });

    expect(service.readProfileId(`araid_session=${token}`)).toBeNull();
  });

  it.each([
    ['araid_line_authorization', 'setLineAuthorization', 'readLineAuthorization'],
    [
      'araid_teacher_access_authorization',
      'setTeacherAccessAuthorization',
      'readTeacherAccessAuthorization',
    ],
  ] as const)('keeps the %s credential in an httpOnly cookie', (name, setter, reader) => {
    const cookie = jest.fn<void, [string, string, Record<string, unknown>]>();
    const response = { cookie } as unknown as Response;

    service[setter](response, 'opaque-token', 600);

    expect(cookie).toHaveBeenCalledWith(
      name,
      'opaque-token',
      expect.objectContaining({ httpOnly: true, maxAge: 600_000, path: '/' }),
    );
    expect(service[reader](`${name}=opaque-token`)).toBe('opaque-token');
    expect(service[reader](`${name}=%E0%A4%A`)).toBeNull();
  });
});
