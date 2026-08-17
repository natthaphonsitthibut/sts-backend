import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';
export const ANY_PERMISSIONS_KEY = 'any_permissions';
export const ROLES_KEY = 'roles';

export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

// OR semantics: the actor needs at least ONE of these permissions. Use when a
// route is reachable by different roles via different permissions (e.g. staff
// via `students`) and a finer own-record
// check happens in the service.
export const RequireAnyPermission = (...permissions: string[]) =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
export const RequireRoles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
