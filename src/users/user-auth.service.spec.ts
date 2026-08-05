import { PasswordService } from '../auth/password.service';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository } from './users.repository';
import { UserAuthService } from './user-auth.service';
import type { HydratableUserRow } from './users.types';

function buildUser(overrides: Partial<HydratableUserRow> = {}): HydratableUserRow {
  return {
    id: 77,
    username: 'student-temp',
    FirstName: 'Student',
    LastName: 'Temp',
    PersonID_Onec: null,
    phone: null,
    email: null,
    affiliation: null,
    status: 'ACTIVE',
    permissions: ['home'],
    role: 'TEACHER',
    data_scope: { school_ids: [10010001] },
    must_change_password: true,
    temporary_password_issued_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    temporary_password_expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000),
    roles: ['TEACHER'],
    labels: ['ครู'],
    role_default_permissions: ['home'],
    password: 'hashed-password',
    ...overrides,
  };
}

describe('UserAuthService login policy', () => {
  let usersRepository: jest.Mocked<
    Pick<UsersRepository, 'findUserByUsername' | 'findCurrentStudentUuidByUserId'>
  >;
  let usersPolicyService: jest.Mocked<
    Pick<UsersPolicyService, 'getRoleMap' | 'hydrateUserPermissions'>
  >;
  let passwordService: jest.Mocked<Pick<PasswordService, 'compare'>>;
  let service: UserAuthService;

  beforeEach(() => {
    usersRepository = {
      findUserByUsername: jest.fn(),
      findCurrentStudentUuidByUserId: jest.fn().mockResolvedValue('student-uuid-1'),
    };
    usersPolicyService = {
      getRoleMap: jest.fn().mockResolvedValue(new Map()),
      hydrateUserPermissions: jest.fn((user) => user),
    };
    passwordService = {
      compare: jest.fn().mockResolvedValue(true),
    };
    service = new UserAuthService(
      usersRepository as unknown as UsersRepository,
      usersPolicyService as unknown as UsersPolicyService,
      passwordService as unknown as PasswordService,
    );
  });

  it('rejects expired temporary-password logins without checking the password hash', async () => {
    usersRepository.findUserByUsername.mockResolvedValue(buildUser());

    await expect(service.validateUser('student-temp', 'TEMP123')).resolves.toBeNull();
    expect(passwordService.compare).not.toHaveBeenCalled();
  });

  it('allows unexpired staff temporary-password logins and hydrates permissions', async () => {
    const user = buildUser({
      temporary_password_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    usersRepository.findUserByUsername.mockResolvedValue(user);

    await expect(service.validateUser('student-temp', 'TEMP123')).resolves.toMatchObject({
      id: 77,
      username: 'student-temp',
    });
    expect(passwordService.compare).toHaveBeenCalledWith('TEMP123', 'hashed-password');
    expect(usersPolicyService.hydrateUserPermissions).toHaveBeenCalled();
  });

  it('rejects a disabled account before checking its password', async () => {
    usersRepository.findUserByUsername.mockResolvedValue(buildUser({ status: 'DISABLED' }));

    await expect(service.validateUser('student-temp', 'TEMP123')).resolves.toBeNull();
    expect(passwordService.compare).not.toHaveBeenCalled();
  });

  it('rejects retired persisted student accounts before checking the password', async () => {
    const user = buildUser({
      role: 'STUDENT',
      roles: ['STUDENT'],
      permissions: ['student-self'],
      must_change_password: false,
      temporary_password_expires_at: null,
    });
    usersRepository.findUserByUsername.mockResolvedValue(user);

    await expect(service.validateUser('student-temp', 'PASSWORD')).resolves.toBeNull();
    expect(passwordService.compare).not.toHaveBeenCalled();
    expect(usersRepository.findCurrentStudentUuidByUserId).not.toHaveBeenCalled();
  });
});
