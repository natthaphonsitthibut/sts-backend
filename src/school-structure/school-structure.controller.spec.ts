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

  it('does not accept the retired teacher-access permission on lookup routes', () => {
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
        ...(method === 'listSchools' ? ['manage-classroom-links'] : []),
        ...(method === 'listSchools' ? ['manage-subjects', 'attendance'] : []),
        'import-data',
        // The school picker is also reachable from จัดการกลุ่มเมนู and จัดการข้อมูลครู.
        ...(method === 'listSchools' ? ['manage-role-groups', 'teachers'] : []),
      ]);
      expect(() => guard.canActivate(context(method))).toThrow();
    }

    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('listTeachers'))).toEqual([
      'manage-school-structure',
    ]);
    expect(() => guard.canActivate(context('listTeachers'))).toThrow();
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('listTeacherOptions'))).toEqual([
      'manage-school-structure',
    ]);
    expect(() => guard.canActivate(context('listTeacherOptions'))).toThrow();

    expect(() => guard.canActivate(context('createTeacherMembership'))).toThrow();
    expect(() => guard.canActivate(context('updateTeacherMembership'))).toThrow();
  });

  it('allows the classroom-link page to load only its scoped school picker', () => {
    const guard = new PermissionsGuard(new Reflector());
    const context = (method: keyof SchoolStructureController) =>
      ({
        getHandler: () => handler(method),
        getClass: () => SchoolStructureController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { roles: [], permissions: ['manage-classroom-links'] },
          }),
        }),
      }) as never;

    expect(guard.canActivate(context('listSchools'))).toBe(true);
    expect(() => guard.canActivate(context('listClassrooms'))).toThrow();
  });

  it.each(['manage-subjects', 'attendance'])(
    'allows the %s page to read scoped school and classroom options',
    (permission) => {
      const guard = new PermissionsGuard(new Reflector());
      const context = (method: keyof SchoolStructureController) =>
        ({
          getHandler: () => handler(method),
          getClass: () => SchoolStructureController,
          switchToHttp: () => ({
            getRequest: () => ({
              user: { id: 1, username: 'page-user', roles: [], permissions: [permission] },
            }),
          }),
        }) as never;

      expect(guard.canActivate(context('listSchools'))).toBe(true);
      expect(guard.canActivate(context('listClassroomOptions'))).toBe(true);
      expect(() => guard.canActivate(context('createClassroom'))).toThrow();
    },
  );

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

  it.each(['students', 'classrooms', 'manage-school-structure', 'attendance'])(
    'lets the %s page use the shared student-comment action',
    (permission) => {
      const guard = new PermissionsGuard(new Reflector());
      const context = {
        getHandler: () => handler('createStudentComment'),
        getClass: () => SchoolStructureController,
        switchToHttp: () => ({
          getRequest: () => ({
            user: { id: 1, username: 'page-user', roles: [], permissions: [permission] },
          }),
        }),
      } as never;

      expect(guard.canActivate(context)).toBe(true);
    },
  );

  it('rejects the shared student-comment action without one of its page permissions', () => {
    const guard = new PermissionsGuard(new Reflector());
    const context = {
      getHandler: () => handler('createStudentComment'),
      getClass: () => SchoolStructureController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 1, username: 'unrelated-user', roles: [], permissions: ['home'] },
        }),
      }),
    } as never;

    expect(() => guard.canActivate(context)).toThrow();
  });
});
