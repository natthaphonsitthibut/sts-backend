import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard, GlobalScopeGuard, PermissionsGuard, RolesGuard } from '../auth';
import {
  ANY_PERMISSIONS_KEY,
  GLOBAL_SCOPE_KEY,
  PERMISSIONS_KEY,
  ROLES_KEY,
} from '../auth/permissions.decorator';
import { StudentStatusController } from './student-status.controller';

function handler(name: string): () => unknown {
  return Object.getOwnPropertyDescriptor(StudentStatusController.prototype, name)
    ?.value as () => unknown;
}

function contextWithPermissions(
  method: string,
  permissions: string[],
  options?: { roles?: string[]; global?: boolean },
): ExecutionContext {
  return {
    getHandler: () => handler(method),
    getClass: () => StudentStatusController,
    switchToHttp: () => ({
      getRequest: () => ({
        user: {
          id: 1,
          username: 'user',
          roles: options?.roles ?? [],
          permissions,
          data_scope: options?.global ? { global: true } : { school_ids: [1] },
        },
      }),
    }),
  } as ExecutionContext;
}

describe('StudentStatusController access', () => {
  it('guards the controller and scopes permissions per route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StudentStatusController)).toEqual([
      AuthGuard,
      PermissionsGuard,
      RolesGuard,
      GlobalScopeGuard,
    ]);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('list'))).toEqual([
      'master-data',
      'settings',
      'import-data',
      'students',
      'manage-students',
    ]);
    for (const method of ['getByCode', 'create', 'update', 'disable']) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler(method))).toEqual(['master-data']);
      expect(Reflect.getMetadata(ROLES_KEY, handler(method))).toEqual(['ADMIN']);
      expect(Reflect.getMetadata(GLOBAL_SCOPE_KEY, handler(method))).toBe(true);
    }
  });

  it('allows settings, import-data or students to list and rejects actors without them', () => {
    const guard = new PermissionsGuard(new Reflector());

    expect(guard.canActivate(contextWithPermissions('list', ['settings']))).toBe(true);
    expect(guard.canActivate(contextWithPermissions('list', ['import-data']))).toBe(true);
    expect(guard.canActivate(contextWithPermissions('list', ['students']))).toBe(true);
    expect(guard.canActivate(contextWithPermissions('list', ['manage-students']))).toBe(true);
    expect(() => guard.canActivate(contextWithPermissions('list', ['home']))).toThrow(
      ForbiddenException,
    );
  });

  it('requires master-data, ADMIN and explicit global scope for mutations', () => {
    const reflector = new Reflector();
    const permissionGuard = new PermissionsGuard(reflector);
    const roleGuard = new RolesGuard(reflector);
    const scopeGuard = new GlobalScopeGuard(reflector);
    const allowed = contextWithPermissions('create', ['master-data'], {
      roles: ['ADMIN'],
      global: true,
    });

    expect(permissionGuard.canActivate(allowed)).toBe(true);
    expect(roleGuard.canActivate(allowed)).toBe(true);
    expect(scopeGuard.canActivate(allowed)).toBe(true);
    expect(() =>
      permissionGuard.canActivate(
        contextWithPermissions('create', ['settings'], { roles: ['ADMIN'], global: true }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      roleGuard.canActivate(
        contextWithPermissions('create', ['master-data'], {
          roles: ['DIRECTOR'],
          global: true,
        }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      scopeGuard.canActivate(
        contextWithPermissions('create', ['master-data'], { roles: ['ADMIN'] }),
      ),
    ).toThrow(ForbiddenException);
  });
});
