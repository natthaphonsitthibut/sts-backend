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

describe('AttendanceController import scope', () => {
  const actor = { id: 7, username: 'teacher' } as never;

  function buildController(): {
    controller: AttendanceController;
    assertClassroomAccess: jest.Mock;
    importService: {
      recordApplied: jest.Mock;
      listApplied: jest.Mock;
      openApplied: jest.Mock;
    };
  } {
    const assertClassroomAccess = jest
      .fn()
      .mockRejectedValue(new ForbiddenException('โรงเรียนอยู่นอกขอบเขตของคุณ'));
    const importService = {
      recordApplied: jest.fn(),
      listApplied: jest.fn(),
      openApplied: jest.fn(),
    };
    const controller = new AttendanceController(
      {} as never,
      { assertClassroomAccess } as never,
      importService as never,
    );
    return { controller, assertClassroomAccess, importService };
  }

  // The stored sheet carries student ids and names, so a classroom id from the
  // query must be checked against the actor's scope — not merely matched.
  it('refuses import history reads for a classroom outside the actor scope', async () => {
    const { controller, assertClassroomAccess, importService } = buildController();

    await expect(
      controller.listImports({ classroomId: 4242, page: 1, limit: 10 }, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(assertClassroomAccess).toHaveBeenCalledWith(4242, actor);
    expect(importService.listApplied).not.toHaveBeenCalled();
  });

  it('refuses a stored import download for a classroom outside the actor scope', async () => {
    const { controller, importService } = buildController();

    await expect(
      controller.downloadImport(1, 4242, { setHeader: jest.fn() } as never, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(importService.openApplied).not.toHaveBeenCalled();
  });

  it('refuses to file an import against a classroom outside the actor scope', async () => {
    const { controller, importService } = buildController();

    await expect(
      controller.recordImport(
        undefined,
        {
          classroomId: 4242,
          attendanceDate: '2026-08-17',
          fileName: 'roster.xlsx',
          rowCount: 1,
          appliedCount: 1,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(importService.recordApplied).not.toHaveBeenCalled();
  });

  it('files the import under the school and term of the classroom, not the request', async () => {
    const { controller, assertClassroomAccess, importService } = buildController();
    assertClassroomAccess.mockResolvedValue({ schoolId: 11, schoolTermId: 22 });
    importService.recordApplied.mockResolvedValue({ id: '1' });

    await controller.recordImport(
      undefined,
      {
        classroomId: 4242,
        attendanceDate: '2026-08-17',
        fileName: 'roster.xlsx',
        rowCount: 1,
        appliedCount: 1,
      },
      { ...(actor as object), FirstName: 'ครู', LastName: 'ทดสอบ' } as never,
    );

    expect(importService.recordApplied).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 11, schoolTermId: 22, classroomId: 4242 }),
    );
  });
});
