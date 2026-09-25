import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { PERMISSIONS_KEY, ROLES_KEY } from '../auth/permissions.decorator';
import { UsersController } from './users.controller';

function handler(name: keyof UsersController): () => unknown {
  return Object.getOwnPropertyDescriptor(UsersController.prototype, name)?.value as () => unknown;
}

describe('UsersController council role-group access', () => {
  it.each([
    'getCouncilRoleGroups',
    'createCouncilRoleGroup',
    'updateCouncilRoleGroup',
    'deleteCouncilRoleGroup',
  ] as const)('requires the permission, not the national ADMIN group, for %s', (method) => {
    // Area council admins manage their own area's groups (owner with BA,
    // 2026-09-25); the service keeps them inside their scope.
    const fn = handler(method);
    expect(Reflect.getMetadata(GUARDS_METADATA, fn)).toEqual([AuthGuard, PermissionsGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, fn)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toEqual(['manage-role-groups']);
  });
});
