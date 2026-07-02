import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard, PermissionsGuard } from '../auth';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { StudentStatusController } from './student-status.controller';

const listHandler = Object.getOwnPropertyDescriptor(StudentStatusController.prototype, 'list')
  ?.value as () => unknown;

function contextWithPermissions(permissions: string[]): ExecutionContext {
  return {
    getHandler: () => listHandler,
    getClass: () => StudentStatusController,
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: 1, username: 'user', roles: [], permissions },
      }),
    }),
  } as ExecutionContext;
}

describe('StudentStatusController access', () => {
  it('protects every route with auth and settings permission', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, StudentStatusController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, StudentStatusController)).toEqual(['settings']);
  });

  it('allows settings permission and rejects actors without it', () => {
    const guard = new PermissionsGuard(new Reflector());

    expect(guard.canActivate(contextWithPermissions(['settings']))).toBe(true);
    expect(() => guard.canActivate(contextWithPermissions([]))).toThrow(ForbiddenException);
  });
});
