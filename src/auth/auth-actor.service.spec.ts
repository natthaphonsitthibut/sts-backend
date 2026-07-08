import { DataSource } from 'typeorm';
import { AuthActorService } from './auth-actor.service';
import { StudentAuthService } from './student-auth.service';
import { SessionCookieService } from './session-cookie.service';
import { MagicSessionStoreService } from './magic-session-store.service';
import type { AuthenticatedRequestUser } from './auth.types';

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
  let dataSource: jest.Mocked<Pick<DataSource, 'createQueryRunner'>>;
  let queryRunner: {
    connect: jest.MockedFunction<() => Promise<void>>;
    query: jest.MockedFunction<
      (sql: string, params: unknown[] | undefined, structured: boolean) => Promise<unknown>
    >;
    release: jest.MockedFunction<() => Promise<void>>;
  };
  let studentAuthService: jest.Mocked<Pick<StudentAuthService, 'loadVirtualStudentActor'>>;
  let sessionCookieService: jest.Mocked<Pick<SessionCookieService, 'readUserId'>>;
  let magicSessionStore: jest.Mocked<Pick<MagicSessionStoreService, 'isVerified'>>;

  beforeEach(() => {
    studentAuthService = {
      loadVirtualStudentActor: jest.fn(),
    };
    sessionCookieService = {
      readUserId: jest.fn().mockReturnValue(null),
    };
    magicSessionStore = {
      isVerified: jest.fn().mockResolvedValue(false),
    };
    queryRunner = {
      connect: jest.fn(() => Promise.resolve()),
      query: jest.fn(() => Promise.resolve({ records: [] })),
      release: jest.fn(() => Promise.resolve()),
    };
    dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    };

    service = new AuthActorService(
      dataSource as unknown as DataSource,
      studentAuthService as unknown as StudentAuthService,
      sessionCookieService as unknown as SessionCookieService,
      magicSessionStore as unknown as MagicSessionStoreService,
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

  it('uses the shared magic session store for OTP-gated magic login actors', async () => {
    magicSessionStore.isVerified.mockResolvedValue(true);
    queryRunner.query.mockResolvedValue({
      records: [
        {
          id: 'link-1',
          assigned_to_email: 'teacher@example.test',
          login_role: 'TEACHER',
          login_permissions: ['home'],
          role_default_permissions: [],
          login_data_scope: { school_ids: [10010002] },
          otp_verified: 0,
          expires_at: '2999-01-01T00:00:00.000Z',
          admin_locked: 0,
          status: 'ACTIVE',
          task_type: 'LOGIN',
        },
      ],
    });

    const actor = await service.loadOptionalUser({
      headers: {
        'x-magic-link-token': 'public-token',
        'x-magic-session': 'session-token',
      },
      session: {},
    });

    expect(actor).toMatchObject({
      username: 'teacher@example.test',
      virtual_login: true,
      auth_source: 'MAGIC_LINK',
    });
    expect(magicSessionStore.isVerified).toHaveBeenCalledWith('link-1', 'session-token');
  });
});
