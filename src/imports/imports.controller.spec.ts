import { type ExecutionContext } from '@nestjs/common';
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
  // Importing teachers and importing students are the same page now, so the
  // controller answers to one permission instead of two.
  it('keeps every import route on the นำเข้าข้อมูล permission', () => {
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, ImportsController)).toEqual(['import-data']);
  });

  it('keeps school checks student-import only and teacher endpoints roster-import only', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler('checkSchools'))).toEqual(['import-data']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler('previewTeacherImport'))).toEqual([
      'import-data',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler('processTeacherImport'))).toEqual([
      'import-data',
    ]);
  });

  it('admits นำเข้าข้อมูล actors to every import route', () => {
    const guard = new PermissionsGuard(new Reflector());

    expect(guard.canActivate(contextWithPermissions('previewTeacherImport', ['import-data']))).toBe(
      true,
    );
    expect(guard.canActivate(contextWithPermissions('processTeacherImport', ['ALL']))).toBe(true);
  });
});
