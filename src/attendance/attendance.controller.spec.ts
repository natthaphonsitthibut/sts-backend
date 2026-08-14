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
      getRequest: () => ({
        user: { id: 1, username: 'user', roles: [], permissions },
      }),
    }),
  } as ExecutionContext;
}

describe('AttendanceController access', () => {
  const guardedReadMethods: Array<keyof AttendanceController> = [
    'getGradeLevels',
    'getSchools',
    'getStudents',
    'getHistory',
    'getRooms',
  ];

  it('keeps every attendance read route behind auth and permissions guards', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AttendanceController)).toEqual([AuthGuard]);

    for (const method of guardedReadMethods) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler(method))).toEqual([PermissionsGuard]);
    }
  });

  it('keeps no unauthenticated route on the attendance controller', () => {
    for (const name of Object.getOwnPropertyNames(AttendanceController.prototype)) {
      if (name === 'constructor') continue;
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler(name as keyof AttendanceController))).toBe(
        undefined,
      );
    }
  });

  it('allows attendance lookup/task reads to the required actors only', () => {
    const guard = new PermissionsGuard(new Reflector());
    const attendanceLookupMethods: Array<keyof AttendanceController> = ['getRooms'];

    for (const method of attendanceLookupMethods) {
      expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler(method))).toEqual([
        'attendance',
        'attendance-dashboard',
        'students',
        'export-data',
      ]);
      expect(guard.canActivate(contextWithPermissions(method, ['attendance']))).toBe(true);
      expect(guard.canActivate(contextWithPermissions(method, ['attendance-dashboard']))).toBe(
        true,
      );
      expect(() => guard.canActivate(contextWithPermissions(method, ['home']))).toThrow(
        ForbiddenException,
      );
    }

    for (const method of ['getSchools'] as const) {
      expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler(method))).toEqual([
        'attendance',
        'attendance-dashboard',
        'students',
        'manage-school-structure',
        'import-data',
        'import-school-roster',
        'export-data',
      ]);
      expect(guard.canActivate(contextWithPermissions(method, ['import-data']))).toBe(true);
      expect(() =>
        guard.canActivate(contextWithPermissions(method, ['manage-teacher-access'])),
      ).toThrow(ForbiddenException);
      expect(guard.canActivate(contextWithPermissions(method, ['import-school-roster']))).toBe(
        true,
      );
      expect(guard.canActivate(contextWithPermissions(method, ['export-data']))).toBe(true);
      expect(() => guard.canActivate(contextWithPermissions(method, ['home']))).toThrow(
        ForbiddenException,
      );
    }

    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('getGradeLevels'))).toEqual([
      'attendance',
      'attendance-dashboard',
      'students',
      'manage-school-structure',
      'export-data',
    ]);
    expect(
      guard.canActivate(contextWithPermissions('getGradeLevels', ['manage-school-structure'])),
    ).toBe(true);
    expect(guard.canActivate(contextWithPermissions('getGradeLevels', ['export-data']))).toBe(true);

    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('getRooms'))).toEqual([
      'attendance',
      'attendance-dashboard',
      'students',
      'export-data',
    ]);
    expect(guard.canActivate(contextWithPermissions('getGradeLevels', ['students']))).toBe(true);
    expect(guard.canActivate(contextWithPermissions('getRooms', ['students']))).toBe(true);
    expect(guard.canActivate(contextWithPermissions('getRooms', ['export-data']))).toBe(true);
  });

  it('allows roster and history reads to attendance actors only', () => {
    const guard = new PermissionsGuard(new Reflector());
    const attendanceOnlyMethods: Array<keyof AttendanceController> = ['getStudents', 'getHistory'];

    for (const method of attendanceOnlyMethods) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler(method))).toEqual(['attendance']);
      expect(guard.canActivate(contextWithPermissions(method, ['attendance']))).toBe(true);
      expect(() =>
        guard.canActivate(contextWithPermissions(method, ['attendance-dashboard'])),
      ).toThrow(ForbiddenException);
    }
  });

  it('separates attendance calendar read and write permissions', () => {
    const guard = new PermissionsGuard(new Reflector());
    const calendarReadMethods: Array<keyof AttendanceController> = ['listCalendar'];
    const calendarWriteMethods: Array<keyof AttendanceController> = [
      'generateCalendar',
      'updateCalendarDay',
    ];

    for (const method of calendarReadMethods) {
      expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler(method))).toEqual([
        'attendance-dashboard',
        'manage-attendance-calendar',
      ]);
      expect(guard.canActivate(contextWithPermissions(method, ['attendance-dashboard']))).toBe(
        true,
      );
      expect(
        guard.canActivate(contextWithPermissions(method, ['manage-attendance-calendar'])),
      ).toBe(true);
      expect(() => guard.canActivate(contextWithPermissions(method, ['settings']))).toThrow(
        ForbiddenException,
      );
    }

    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('listTerms'))).toEqual([
      'attendance-dashboard',
      'manage-attendance-calendar',
      'manage-school-structure',
      'import-data',
      'import-school-roster',
    ]);
    expect(
      guard.canActivate(contextWithPermissions('listTerms', ['manage-school-structure'])),
    ).toBe(true);
    expect(() =>
      guard.canActivate(contextWithPermissions('listTerms', ['manage-teacher-access'])),
    ).toThrow(ForbiddenException);
    expect(guard.canActivate(contextWithPermissions('listTerms', ['import-data']))).toBe(true);

    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler('upsertTerm'))).toEqual([
      'manage-attendance-calendar',
      'manage-school-structure',
    ]);
    expect(
      guard.canActivate(contextWithPermissions('upsertTerm', ['manage-school-structure'])),
    ).toBe(true);

    for (const method of calendarWriteMethods) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler(method))).toEqual([
        'manage-attendance-calendar',
      ]);
      expect(
        guard.canActivate(contextWithPermissions(method, ['manage-attendance-calendar'])),
      ).toBe(true);
      expect(() => guard.canActivate(contextWithPermissions(method, ['settings']))).toThrow(
        ForbiddenException,
      );
    }
  });
});
