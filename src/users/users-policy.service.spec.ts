import { ForbiddenException } from '@nestjs/common';
import { UsersPolicyService } from './users-policy.service';
import { UsersRepository } from './users.repository';
import type { ActorContext, RoleDefinition } from './users.types';

const definitions: RoleDefinition[] = [
  {
    id: 1,
    name: 'ADMIN',
    label: 'ผู้ดูแลระบบ',
    rank: 5,
    default_permissions: ['home', 'manage-users-list'],
    scope_mode: 'flexible',
    scope_policy: 'ASSIGNABLE',
    is_assignable: true,
    is_system: true,
  },
  {
    id: 2,
    name: 'STUDENT',
    label: 'นักเรียน',
    rank: 1,
    default_permissions: ['home', 'student-self'],
    scope_mode: 'flexible',
    scope_policy: 'OWN_ONLY',
    is_assignable: true,
    is_system: true,
  },
];

const roleMap = new Map(definitions.map((role) => [role.name, role]));
const globalAdmin: ActorContext = {
  id: 1,
  username: 'global-admin',
  roles: ['ADMIN'],
  permissions: ['home', 'manage-users-list'],
  data_scope: { global: true },
};

describe('UsersPolicyService functional roles and data scope', () => {
  const service = new UsersPolicyService({} as UsersRepository);

  it('allows one ADMIN role to be assigned with a school scope', async () => {
    await expect(
      service.assertAssignablePayload(
        globalAdmin,
        {
          role: 'ADMIN',
          roles: ['ADMIN'],
          permissions: ['home'],
          data_scope: { school_ids: [10010002] },
        },
        { allowEqualRole: true },
        roleMap,
      ),
    ).resolves.toBeUndefined();
  });

  it('rejects assigning global scope from a school-scoped admin', async () => {
    await expect(
      service.assertAssignablePayload(
        { ...globalAdmin, data_scope: { school_ids: [10010002] } },
        {
          role: 'ADMIN',
          roles: ['ADMIN'],
          permissions: ['home'],
          data_scope: { global: true },
        },
        { allowEqualRole: true },
        roleMap,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects an assignable role when no explicit scope is selected', async () => {
    await expect(
      service.assertAssignablePayload(
        globalAdmin,
        {
          role: 'ADMIN',
          roles: ['ADMIN'],
          permissions: ['home'],
          data_scope: {},
        },
        { allowEqualRole: true },
        roleMap,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires own-only scope for STUDENT', async () => {
    await expect(
      service.assertAssignablePayload(
        globalAdmin,
        {
          role: 'STUDENT',
          roles: ['STUDENT'],
          permissions: ['home', 'student-self'],
          data_scope: { school_ids: [10010002] },
        },
        { allowEqualRole: true },
        roleMap,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      service.assertAssignablePayload(
        globalAdmin,
        {
          role: 'STUDENT',
          roles: ['STUDENT'],
          permissions: ['home', 'student-self'],
          data_scope: { school_ids: [10010002], own_only: true },
        },
        { allowEqualRole: true },
        roleMap,
      ),
    ).resolves.toBeUndefined();
  });
});
