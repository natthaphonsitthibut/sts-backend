import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard, PermissionsGuard } from '../auth';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { SchoolStructureController } from './school-structure.controller';

function handler(name: keyof SchoolStructureController): () => unknown {
  return Object.getOwnPropertyDescriptor(SchoolStructureController.prototype, name)
    ?.value as () => unknown;
}

describe('SchoolStructureController access', () => {
  it('guards the controller with the dedicated school-structure permission', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SchoolStructureController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SchoolStructureController)).toEqual([
      'manage-school-structure',
    ]);
  });

  it('allows teacher-access administrators to use read-only lookup routes only', () => {
    const reflector = new Reflector();
    const guard = new PermissionsGuard(reflector);
    const context = (method: keyof SchoolStructureController) =>
      ({
        getHandler: () => handler(method),
        getClass: () => SchoolStructureController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: {
              id: 1,
              username: 'teacher-access-admin',
              roles: [],
              permissions: ['manage-teacher-access'],
            },
          }),
        }),
      }) as never;

    for (const method of ['listSchools', 'listClassrooms'] as const) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler(method))).toEqual([]);
      expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler(method))).toEqual([
        'manage-school-structure',
        'manage-teacher-access',
        'import-data',
        'import-school-roster',
      ]);
      expect(guard.canActivate(context(method))).toBe(true);
    }

    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('listTeachers'))).toEqual([
      'manage-school-structure',
      'manage-teacher-access',
    ]);
    expect(guard.canActivate(context('listTeachers'))).toBe(true);

    expect(() => guard.canActivate(context('createTeacherMembership'))).toThrow();
    expect(() => guard.canActivate(context('updateTeacherMembership'))).toThrow();
  });

  it('allows import actors to read scoped schools and classrooms but not write them', () => {
    const guard = new PermissionsGuard(new Reflector());
    const context = (method: keyof SchoolStructureController) =>
      ({
        getHandler: () => handler(method),
        getClass: () => SchoolStructureController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 1, username: 'importer', roles: [], permissions: ['import-data'] },
          }),
        }),
      }) as never;

    expect(guard.canActivate(context('listSchools'))).toBe(true);
    expect(guard.canActivate(context('listClassrooms'))).toBe(true);
    expect(() => guard.canActivate(context('createClassroom'))).toThrow();
  });
});
