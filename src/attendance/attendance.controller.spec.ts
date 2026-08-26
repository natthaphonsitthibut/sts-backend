import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard, PermissionsGuard } from '../auth';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { AttendanceController } from './attendance.controller';

function handler(name: keyof AttendanceController): () => unknown {
  return Object.getOwnPropertyDescriptor(AttendanceController.prototype, name)
    ?.value as () => unknown;
}

function contextWithPermissions(
  method: keyof AttendanceController,
  permissions: string[],
): ExecutionContext {
  return {
    getHandler: () => handler(method),
    getClass: () => AttendanceController,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: 1, username: 'user', roles: [], permissions } }),
    }),
  } as ExecutionContext;
}

describe('AttendanceController access', () => {
  it('keeps every attendance route authenticated', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AttendanceController)).toEqual([AuthGuard]);

    for (const name of Object.getOwnPropertyNames(AttendanceController.prototype)) {
      if (name === 'constructor') continue;
      const method = name as keyof AttendanceController;
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler(method))).toBeUndefined();
      expect(Reflect.getMetadata(GUARDS_METADATA, handler(method))).toEqual([PermissionsGuard]);
    }
  });

  it('allows shared lookup routes only to their current consumers', () => {
    const guard = new PermissionsGuard(new Reflector());

    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('getSchools'))).toEqual([
      'attendance',
      'students',
      'manage-school-structure',
      'import-data',
      'export-data',
    ]);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('getGradeLevels'))).toEqual([
      'attendance',
      'students',
      'manage-school-structure',
      'manage-classroom-links',
      'export-data',
    ]);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('getRooms'))).toEqual([
      'attendance',
      'students',
      'export-data',
    ]);
    expect(guard.canActivate(contextWithPermissions('getSchools', ['import-data']))).toBe(true);
    expect(guard.canActivate(contextWithPermissions('getRooms', ['students']))).toBe(true);
    expect(() => guard.canActivate(contextWithPermissions('getRooms', ['home']))).toThrow(
      ForbiddenException,
    );
  });

  it('keeps roster, history, and check-in routes on attendance permission', () => {
    const guard = new PermissionsGuard(new Reflector());
    const methods: Array<keyof AttendanceController> = [
      'getStudents',
      'getHistory',
      'checkInOptions',
      'checkInRoster',
      'checkInStudentPhoto',
      'startCheckInSession',
      'submitCheckInSession',
    ];

    for (const method of methods) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler(method))).toEqual(['attendance']);
      expect(guard.canActivate(contextWithPermissions(method, ['attendance']))).toBe(true);
      expect(() => guard.canActivate(contextWithPermissions(method, ['dashboard']))).toThrow(
        ForbiddenException,
      );
    }
  });

  it('separates term reads from school-level term writes and deletion', () => {
    const guard = new PermissionsGuard(new Reflector());

    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('listTerms'))).toEqual([
      'attendance',
      'manage-school-structure',
      'manage-classroom-links',
      'manage-subjects',
      'import-data',
    ]);
    expect(guard.canActivate(contextWithPermissions('listTerms', ['attendance']))).toBe(true);

    for (const method of ['upsertTerm', 'deleteTerm'] as const) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler(method))).toEqual([
        'manage-school-structure',
      ]);
      expect(guard.canActivate(contextWithPermissions(method, ['manage-school-structure']))).toBe(
        true,
      );
      expect(() => guard.canActivate(contextWithPermissions(method, ['attendance']))).toThrow(
        ForbiddenException,
      );
    }
  });
});
