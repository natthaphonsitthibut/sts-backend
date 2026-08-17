import { DataSource } from 'typeorm';
import { AuthActorService } from './auth-actor.service';
import { SessionCookieService } from './session-cookie.service';
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
  let sessionCookieService: jest.Mocked<Pick<SessionCookieService, 'readUserId'>>;

  beforeEach(() => {
    sessionCookieService = {
      readUserId: jest.fn().mockReturnValue(null),
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
      sessionCookieService as unknown as SessionCookieService,
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
    const actor = await service.loadOptionalUser({
      headers: {
        cookie: 'sts_session=signed-token',
        'x-magic-link-token': 'magic-token',
        'x-magic-session': 'magic-session',
      },
      session: {},
    });

    expect(actor).toEqual(localActor);
    expect(loadUserSpy).toHaveBeenCalledWith(42);
  });

  it('keeps an explicitly empty stored permission list empty', async () => {
    sessionCookieService.readUserId.mockReturnValue(42);
    queryRunner.query.mockResolvedValue({
      records: [
        {
          id: 42,
          username: 'restricted-admin',
          roles: ['ADMIN'],
          permissions: [],
          data_scope: {},
          role_default_permissions: ['home', 'export-data'],
        },
      ],
    });

    const actor = await service.loadRequiredUser({
      headers: { cookie: 'sts_session=signed-token' },
      session: {},
    });

    expect(actor?.permissions).toEqual([]);
  });

  it('uses role defaults only for legacy non-array permission values', async () => {
    sessionCookieService.readUserId.mockReturnValue(42);
    queryRunner.query.mockResolvedValue({
      records: [
        {
          id: 42,
          username: 'legacy-admin',
          roles: ['ADMIN'],
          permissions: null,
          data_scope: {},
          role_default_permissions: ['home', 'export-data'],
        },
      ],
    });

    const actor = await service.loadRequiredUser({
      headers: { cookie: 'sts_session=signed-token' },
      session: {},
    });

    expect(actor?.permissions).toEqual(['home', 'export-data']);
  });

  it('rejects retired magic-login headers', async () => {
    const actor = await service.loadOptionalUser({
      headers: {
        'x-magic-link-token': 'magic-token',
        'x-magic-session': 'magic-session',
      },
      session: {},
    });

    expect(actor).toBeNull();
    expect(queryRunner.query).not.toHaveBeenCalled();
  });

  it('returns null when the request has no supported auth source', async () => {
    const actor = await service.loadOptionalUser({
      headers: {},
      session: {},
    });

    expect(actor).toBeNull();
  });
});
