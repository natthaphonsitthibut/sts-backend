import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard, GlobalScopeGuard, PermissionsGuard, RolesGuard } from '../auth';
import { GLOBAL_SCOPE_KEY, PERMISSIONS_KEY, ROLES_KEY } from '../auth/permissions.decorator';
import { SchoolAdminController } from './school-admin.controller';

function handler(name: keyof SchoolAdminController): () => unknown {
  return Object.getOwnPropertyDescriptor(SchoolAdminController.prototype, name)
    ?.value as () => unknown;
}

describe('SchoolAdminController access', () => {
  it('requires ADMIN with a global scope for every school master-data route', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SchoolAdminController)).toEqual([
      AuthGuard,
      PermissionsGuard,
      RolesGuard,
      GlobalScopeGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SchoolAdminController)).toEqual(['manage-schools']);
    expect(Reflect.getMetadata(ROLES_KEY, SchoolAdminController)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(GLOBAL_SCOPE_KEY, SchoolAdminController)).toBe(true);
  });

  it.each([
    'listSchools',
    'createSchool',
    'updateSchool',
    'deactivateSchool',
    'listProvinces',
    'listDistricts',
    'listSubDistricts',
  ] as const)('does not loosen the %s handler metadata', (method) => {
    const fn = handler(method);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, fn)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, fn)).toBeUndefined();
    expect(Reflect.getMetadata(GLOBAL_SCOPE_KEY, fn)).toBeUndefined();
  });

  it('keeps the global scope guard fail-closed for a school-scoped actor', () => {
    const reflector = new Reflector();
    const guard = new GlobalScopeGuard(reflector);
    const context = {
      getHandler: () => handler('listSchools'),
      getClass: () => SchoolAdminController,
      switchToHttp: () => ({
        getRequest: () => ({ user: { data_scope: { school_ids: [1001] } } }),
      }),
    } as never;

    expect(() => guard.canActivate(context)).toThrow();
  });
});
