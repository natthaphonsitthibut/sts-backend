import { DataSource } from 'typeorm';
import { AuthActorService } from './auth-actor.service';
import { StudentAuthService } from './student-auth.service';
import { SessionCookieService } from './session-cookie.service';
import type { AuthenticatedRequestUser } from './auth.types';
import type { AuthRuntimeConfig } from '../config/auth.config';

function buildActor(overrides: Partial<AuthenticatedRequestUser> = {}): AuthenticatedRequestUser {
  return {
    id: 1,
    username: 'tester',
    roles: ['ADMIN'],
    permissions: ['home'],
    data_scope: {},
    ...overrides,
  };
}

describe('AuthActorService', () => {
  let service: AuthActorService;
  let studentAuthService: jest.Mocked<Pick<StudentAuthService, 'loadVirtualStudentActor'>>;
  let sessionCookieService: jest.Mocked<Pick<SessionCookieService, 'readUserId'>>;

  beforeEach(() => {
    studentAuthService = {
      loadVirtualStudentActor: jest.fn(),
    };
    sessionCookieService = {
      readUserId: jest.fn().mockReturnValue(null),
    };

    const authRuntimeConfig: AuthRuntimeConfig = {
      jwtSecret: 'test-jwt-secret-value',
      sessionSecret: 'test-session-secret-value',
      magicSessionTtlSeconds: 60,
      otpTtlSeconds: 60,
      otpMaxAttempts: 5,
      otpLockSeconds: 60,
      cookieName: 'sts_session',
      cookieSecure: false,
      cookieSameSite: 'lax',
      tokenTtlSeconds: 60,
      thaidMode: 'mock',
    };

    service = new AuthActorService(
      {} as DataSource,
      studentAuthService as unknown as StudentAuthService,
      sessionCookieService as unknown as SessionCookieService,
      authRuntimeConfig,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prefers local user loading when a signed session cookie is present', async () => {
    const localActor = buildActor({ id: 42, username: 'local-user' });
    sessionCookieService.readUserId.mockReturnValue(42);
    const loadUserSpy = jest
      .spyOn(service as never, 'loadUser' as never)
      .mockResolvedValue(localActor as never);
    const loadMagicLinkUserSpy = jest
      .spyOn(service as never, 'loadMagicLinkUser' as never)
      .mockResolvedValue(buildActor({ auth_source: 'MAGIC_LINK' }) as never);

    studentAuthService.loadVirtualStudentActor.mockReturnValue(
      buildActor({ auth_source: 'THAID_MOCK', virtual_login: true }),
    );

    const actor = await service.loadOptionalUser({
      headers: {
        cookie: 'sts_session=signed-token',
        'x-virtual-auth': 'virtual-token',
        'x-magic-link-token': 'magic-token',
        'x-magic-session': 'magic-session',
      },
      session: {},
    });

    expect(actor).toEqual(localActor);
    expect(loadUserSpy).toHaveBeenCalledWith(42);
    expect(studentAuthService.loadVirtualStudentActor).not.toHaveBeenCalled();
    expect(loadMagicLinkUserSpy).not.toHaveBeenCalled();
  });

  it('prefers virtual student auth over magic login when no local user exists', async () => {
    const virtualActor = buildActor({
      id: -77,
      username: 'student-user',
      roles: ['STUDENT'],
      permissions: ['student-self'],
      data_scope: { own_only: true },
      virtual_login: true,
      auth_source: 'THAID_MOCK',
      PersonID_Onec: '1234567890123',
    });

    const loadMagicLinkUserSpy = jest
      .spyOn(service as never, 'loadMagicLinkUser' as never)
      .mockResolvedValue(buildActor({ auth_source: 'MAGIC_LINK' }) as never);

    studentAuthService.loadVirtualStudentActor.mockReturnValue(virtualActor);

    const actor = await service.loadOptionalUser({
      headers: {
        'x-virtual-auth': 'virtual-token',
        'x-magic-link-token': 'magic-token',
      },
      session: {},
    });

    expect(actor).toEqual(virtualActor);
    expect(studentAuthService.loadVirtualStudentActor).toHaveBeenCalledWith('virtual-token');
    expect(loadMagicLinkUserSpy).not.toHaveBeenCalled();
  });

  it('falls back to magic login when only magic headers are present', async () => {
    const magicActor = buildActor({
      id: -88,
      username: 'magic-user',
      roles: ['TEACHER'],
      permissions: ['home'],
      virtual_login: true,
      auth_source: 'MAGIC_LINK',
    });

    const loadMagicLinkUserSpy = jest
      .spyOn(service as never, 'loadMagicLinkUser' as never)
      .mockResolvedValue(magicActor as never);

    const actor = await service.loadOptionalUser({
      headers: {
        'x-magic-link-token': 'magic-token',
        'x-magic-session': 'magic-session',
      },
      session: {},
    });

    expect(actor).toEqual(magicActor);
    expect(studentAuthService.loadVirtualStudentActor).not.toHaveBeenCalled();
    expect(loadMagicLinkUserSpy).toHaveBeenCalledWith('magic-token', 'magic-session');
  });

  it('returns null when the request has no supported auth source', async () => {
    const actor = await service.loadOptionalUser({
      headers: {},
      session: {},
    });

    expect(actor).toBeNull();
    expect(studentAuthService.loadVirtualStudentActor).not.toHaveBeenCalled();
  });
});
