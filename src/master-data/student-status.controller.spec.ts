import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard, PermissionsGuard } from '../auth';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { StudentStatusController } from './student-status.controller';

function handler(name: string): () => unknown {
  return Object.getOwnPropertyDescriptor(StudentStatusController.prototype, name)
    ?.value as () => unknown;
}

function contextWithPermissions(method: string, permissions: string[]): ExecutionContext {
  return {
    getHandler: () => handler(method),
    getClass: () => StudentStatusController,
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: 1, username: 'user', roles: [], permissions },
      }),
    }),
  } as ExecutionContext;
}

describe('StudentStatusController access', () => {
  it('guards the controller and scopes permissions per route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StudentStatusController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('list'))).toEqual([
      'settings',
      'import-data',
    ]);
    for (const method of ['getByCode', 'create', 'update', 'disable']) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler(method))).toEqual(['settings']);
    }
  });

  it('allows settings or import-data to list and rejects actors without either', () => {
    const guard = new PermissionsGuard(new Reflector());

    expect(guard.canActivate(contextWithPermissions('list', ['settings']))).toBe(true);
    expect(guard.canActivate(contextWithPermissions('list', ['import-data']))).toBe(true);
    expect(() => guard.canActivate(contextWithPermissions('list', ['home']))).toThrow(
      ForbiddenException,
    );
  });

  it('keeps mutating routes settings-only', () => {
    const guard = new PermissionsGuard(new Reflector());

    expect(guard.canActivate(contextWithPermissions('create', ['settings']))).toBe(true);
    expect(() => guard.canActivate(contextWithPermissions('create', ['import-data']))).toThrow(
      ForbiddenException,
    );
  });
});
