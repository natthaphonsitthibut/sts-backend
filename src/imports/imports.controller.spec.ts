import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../auth';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { ImportsController } from './imports.controller';

function handler(name: string): () => unknown {
  return Object.getOwnPropertyDescriptor(ImportsController.prototype, name)?.value as () => unknown;
}

function contextWithPermissions(method: string, permissions: string[]): ExecutionContext {
  return {
    getHandler: () => handler(method),
    getClass: () => ImportsController,
    switchToHttp: () => ({
      getRequest: () => ({
        user: { id: 1, username: 'user', roles: [], permissions },
      }),
    }),
  } as ExecutionContext;
}

describe('ImportsController access', () => {
  it('keeps the shared catalog routes available to either import capability', () => {
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, ImportsController)).toEqual([
      'import-data',
      'import-school-roster',
    ]);
  });

  it('keeps school checks student-import only and teacher endpoints roster-import only', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler('checkSchools'))).toEqual(['import-data']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler('previewTeacherImport'))).toEqual([
      'import-school-roster',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler('processTeacherImport'))).toEqual([
      'import-school-roster',
    ]);
  });

  it('denies import-data-only actors from the legacy teacher import routes', () => {
    const guard = new PermissionsGuard(new Reflector());

    expect(() =>
      guard.canActivate(contextWithPermissions('previewTeacherImport', ['import-data'])),
    ).toThrow(ForbiddenException);
    expect(
      guard.canActivate(contextWithPermissions('previewTeacherImport', ['import-school-roster'])),
    ).toBe(true);
    expect(guard.canActivate(contextWithPermissions('processTeacherImport', ['ALL']))).toBe(true);
  });
});
