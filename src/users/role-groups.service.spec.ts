import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RoleGroupsService } from './role-groups.service';
import { UsersPolicyService } from './users-policy.service';
import type { ActorContext, RoleRow } from './users.types';

const ACTOR: ActorContext = {
  id: 7,
  username: 'school-admin',
  roles: ['ADMIN'],
  permissions: ['*'],
  data_scope: { school_ids: [1001] },
};

const ADMIN_ROLE: RoleRow = {
  id: 1,
  name: 'ADMIN',
  label: 'ผู้ดูแลระบบ',
  sort_order: 5,
  default_permissions: ['*'],
  scope_mode: 'flexible',
  scope_policy: 'ASSIGNABLE',
  is_assignable: true,
  is_system: true,
  school_id: null,
};

const SCHOOL_ROLE: RoleRow = {
  id: 11,
  name: 'S1001_ROLE_A',
  label: 'ผู้ดูแลห้องเรียน',
  sort_order: 4,
  default_permissions: ['manage-users-list', 'manage-role-groups'],
  scope_mode: 'school',
  scope_policy: 'ASSIGNABLE',
  is_assignable: true,
  is_system: false,
  school_id: 1001,
  user_count: 0,
};

const OTHER_SCHOOL_ROLE: RoleRow = {
  ...SCHOOL_ROLE,
  id: 12,
  name: 'S2002_ROLE_A',
  school_id: 2002,
};

describe('RoleGroupsService school ownership', () => {
  function setup() {
    const repository = {
      listRoleRows: jest.fn((_includeUsage: boolean, schoolId?: number) =>
        Promise.resolve(
          schoolId === 1001
            ? [ADMIN_ROLE, SCHOOL_ROLE]
            : [ADMIN_ROLE, SCHOOL_ROLE, OTHER_SCHOOL_ROLE],
        ),
      ),
      isSchoolInScope: jest.fn((schoolId: number) => Promise.resolve(schoolId === 1001)),
      schoolRoleLabelExists: jest.fn().mockResolvedValue(false),
      createRole: jest.fn((input: Record<string, unknown>) =>
        Promise.resolve({
          ...SCHOOL_ROLE,
          ...input,
          id: 13,
        }),
      ),
      updateRole: jest.fn((_name: string, input: Record<string, unknown>) =>
        Promise.resolve({
          ...SCHOOL_ROLE,
          ...input,
        }),
      ),
      deleteRole: jest.fn().mockResolvedValue(undefined),
    };
    const policy = new UsersPolicyService(repository as never);
    return {
      service: new RoleGroupsService(repository as never, policy),
      repository,
    };
  }

  it('lists only the selected school and keeps the existing pagination contract', async () => {
    const { service, repository } = setup();

    await expect(
      service.getRoleGroups(ACTOR, { schoolId: 1001, page: 1, limit: 10 }),
    ).resolves.toMatchObject({
      success: true,
      data: [{ name: 'S1001_ROLE_A', school_id: 1001 }],
      meta: { page: 1, limit: 10, totalCount: 1 },
    });
    expect(repository.isSchoolInScope).toHaveBeenCalledWith(1001, ACTOR.data_scope);
    expect(repository.listRoleRows).toHaveBeenCalledWith(true, 1001);
  });

  it('rejects a non-global actor from council role groups', async () => {
    const { service, repository } = setup();

    await expect(service.getCouncilRoleGroups(ACTOR)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.getCouncilRoleGroups({
        ...ACTOR,
        data_scope: { province: 'เชียงใหม่' },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.listRoleRows).not.toHaveBeenCalled();
  });

  it('infers a single-school actor but requires a selection for broader scopes', async () => {
    const { service } = setup();

    await expect(service.getRoleGroups(ACTOR)).resolves.toMatchObject({
      data: [{ school_id: 1001 }],
    });
    await expect(
      service.getRoleGroups({ ...ACTOR, data_scope: { global: true } }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('hides whether an out-of-scope school exists', async () => {
    const { service, repository } = setup();
    repository.isSchoolInScope.mockResolvedValue(false);

    await expect(service.getRoleGroups(ACTOR, { schoolId: 2002 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.listRoleRows).not.toHaveBeenCalled();
  });

  it('creates an opaque school-owned role without accepting a client-owned scope', async () => {
    const { service, repository } = setup();

    await expect(
      service.createRoleGroup(ACTOR, {
        schoolId: 1001,
        label: 'ครูฝ่ายปกครอง',
        sort_order: 4,
        default_permissions: ['manage-users-list'],
        scope_mode: 'global',
      }),
    ).resolves.toMatchObject({ role: { school_id: 1001, scope_mode: 'school' } });
    const createdInput = repository.createRole.mock.calls[0]?.[0];
    expect(String(createdInput?.name)).toMatch(/^S1001_[A-F0-9]{24}$/);
    expect(createdInput?.school_id).toBe(1001);
    expect(createdInput?.scope_mode).toBe('school');
  });

  it('maps a concurrent duplicate label to a stable conflict response', async () => {
    const { service, repository } = setup();
    repository.createRole.mockRejectedValue({ code: '23505' });

    await expect(
      service.createRoleGroup(ACTOR, {
        schoolId: 1001,
        label: 'ครูฝ่ายปกครอง',
        sort_order: 4,
        default_permissions: ['manage-users-list'],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects editing a group owned by another school', async () => {
    const { service } = setup();

    await expect(
      service.updateRoleGroup(ACTOR, OTHER_SCHOOL_ROLE.name, { label: 'กลุ่มใหม่' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('RoleGroupsService council areas', () => {
  const DISTRICT = { province_code: '50', district_code: '5001', sub_district_code: null };
  const areaRole = (name: string, overrides: Partial<RoleRow> = {}): RoleRow => ({
    id: name.length,
    name,
    label: 'ผู้ดูแลระบบ',
    default_permissions: ['home', 'dashboard'],
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
    is_assignable: true,
    is_system: false,
    school_id: null,
    owner_province_code: '50',
    owner_district_code: '5001',
    owner_sub_district_code: null,
    owner_province: 'เชียงใหม่',
    owner_district: 'เมืองเชียงใหม่',
    owner_sub_district: null,
    user_count: 0,
    ...overrides,
  });
  const DISTRICT_ADMIN_GROUP = areaRole('A5001_BASE_ADMIN');
  const SUB_DISTRICT_GROUP = areaRole('A500101_BASE_ADMIN', {
    owner_sub_district_code: '500101',
    owner_sub_district: 'ศรีภูมิ',
  });
  const OTHER_DISTRICT_GROUP = areaRole('A5011_BASE_ADMIN', {
    owner_district_code: '5011',
    owner_district: 'สารภี',
  });

  const NATIONAL: ActorContext = {
    id: 1,
    username: 'council.admin',
    roles: ['ADMIN'],
    permissions: ['*'],
    data_scope: { global: true },
  };
  const DISTRICT_ADMIN: ActorContext = {
    id: 2,
    username: 'district.admin',
    roles: ['A5001_BASE_ADMIN'],
    permissions: ['home', 'manage-users-list', 'manage-role-groups'],
    data_scope: { provinces: ['เชียงใหม่'], districts: ['เมืองเชียงใหม่'] },
  };
  const SUB_DISTRICT_ADMIN: ActorContext = {
    ...DISTRICT_ADMIN,
    id: 3,
    roles: ['A500101_BASE_ADMIN'],
    data_scope: {
      provinces: ['เชียงใหม่'],
      districts: ['เมืองเชียงใหม่'],
      sub_districts: ['ศรีภูมิ'],
    },
  };

  function setup() {
    const repository = {
      listRoleRows: jest
        .fn()
        .mockResolvedValue([
          ADMIN_ROLE,
          DISTRICT_ADMIN_GROUP,
          SUB_DISTRICT_GROUP,
          OTHER_DISTRICT_GROUP,
        ]),
      resolveAreaCodes: jest.fn().mockResolvedValue(DISTRICT),
      ensureAreaDefaultRoles: jest.fn().mockResolvedValue(undefined),
      areaRoleLabelExists: jest.fn().mockResolvedValue(false),
      createRole: jest.fn((input: Record<string, unknown>) =>
        Promise.resolve({ ...DISTRICT_ADMIN_GROUP, ...input, id: 99 }),
      ),
      updateRole: jest.fn((_name: string, input: Record<string, unknown>) =>
        Promise.resolve({ ...DISTRICT_ADMIN_GROUP, ...input }),
      ),
      deleteRole: jest.fn().mockResolvedValue(undefined),
    };
    const policy = new UsersPolicyService(repository as never);
    return { service: new RoleGroupsService(repository as never, policy), repository };
  }

  it('lists exactly the picked area and creates its starter groups', async () => {
    const { service, repository } = setup();

    const result = await service.getCouncilRoleGroups(NATIONAL, {
      province: 'เชียงใหม่',
      district: 'เมืองเชียงใหม่',
    });
    expect(result.data.map((role) => role.name)).toEqual(['A5001_BASE_ADMIN']);
    expect(repository.ensureAreaDefaultRoles).toHaveBeenCalledWith(
      DISTRICT,
      expect.arrayContaining([expect.objectContaining({ key: 'EXECUTIVE' })]),
    );
  });

  it('needs an area picked, unless the account belongs to one', async () => {
    const { service, repository } = setup();

    await expect(service.getCouncilRoleGroups(NATIONAL)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await service.getCouncilRoleGroups(DISTRICT_ADMIN);
    expect(repository.resolveAreaCodes).toHaveBeenCalledWith({
      province: 'เชียงใหม่',
      district: 'เมืองเชียงใหม่',
      subDistrict: null,
    });
  });

  it('keeps an area admin inside its own area', async () => {
    const { service, repository } = setup();

    await expect(
      service.getCouncilRoleGroups(DISTRICT_ADMIN, { province: 'เชียงใหม่', district: 'สารภี' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateCouncilRoleGroup(SUB_DISTRICT_ADMIN, 'A5001_BASE_ADMIN', { label: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.updateCouncilRoleGroup(DISTRICT_ADMIN, 'ADMIN', { label: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.updateRole).not.toHaveBeenCalled();
  });

  it('creates a group owned by the picked area', async () => {
    const { service, repository } = setup();

    await service.createCouncilRoleGroup(NATIONAL, {
      label: 'ผู้ประสานงาน',
      default_permissions: ['home'],
      province: 'เชียงใหม่',
      district: 'เมืองเชียงใหม่',
    });
    const [created] = repository.createRole.mock.calls[0];
    expect(created.school_id).toBeNull();
    expect(created.owner_area).toMatchObject(DISTRICT);
    expect(String(created.name)).toMatch(/^A5001_/);
  });
});
