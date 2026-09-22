import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard, RolesGuard } from '../auth';
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
  ] as const)('requires ADMIN and permission guards for %s', (method) => {
    const fn = handler(method);
    expect(Reflect.getMetadata(GUARDS_METADATA, fn)).toEqual([
      AuthGuard,
      RolesGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, fn)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toEqual(['manage-role-groups']);
  });
});
