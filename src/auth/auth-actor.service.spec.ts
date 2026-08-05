import { DataSource } from 'typeorm';
import { AuthActorService } from './auth-actor.service';
import { StudentAuthService } from './student-auth.service';
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
  let studentAuthService: jest.Mocked<Pick<StudentAuthService, 'loadVirtualStudentActor'>>;
  let sessionCookieService: jest.Mocked<Pick<SessionCookieService, 'readUserId'>>;

  beforeEach(() => {
    studentAuthService = {
      loadVirtualStudentActor: jest.fn(),
    };
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
      studentAuthService as unknown as StudentAuthService,
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
    studentAuthService.loadVirtualStudentActor.mockResolvedValue(
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
  });

  it('prefers virtual student auth when no local user exists', async () => {
    const virtualActor = buildActor({
      id: -77,
      username: 'student-user',
      roles: [],
      permissions: ['student-self'],
      data_scope: { own_only: true },
      virtual_login: true,
      auth_source: 'THAID_MOCK',
      PersonID_Onec: '1234567890123',
    });

    studentAuthService.loadVirtualStudentActor.mockResolvedValue(virtualActor);

    const actor = await service.loadOptionalUser({
      headers: {
        'x-virtual-auth': 'virtual-token',
        'x-magic-link-token': 'magic-token',
      },
      session: {},
    });

    expect(actor).toEqual(virtualActor);
    expect(studentAuthService.loadVirtualStudentActor).toHaveBeenCalledWith('virtual-token');
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
    expect(studentAuthService.loadVirtualStudentActor).not.toHaveBeenCalled();
    expect(queryRunner.query).not.toHaveBeenCalled();
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
