import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { StudentsController } from './students.controller';

function handlerOf(methodName: string): () => unknown {
  return Object.getOwnPropertyDescriptor(StudentsController.prototype, methodName)
    ?.value as () => unknown;
}

describe('StudentsController', () => {
  it('protects student write routes with the จัดการนักเรียน page permission', () => {
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, StudentsController) as unknown[];

    expect(classGuards).toEqual([AuthGuard, PermissionsGuard]);
    for (const methodName of ['create', 'remove']) {
      const handler = handlerOf(methodName);
      const methodGuards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];

      expect(methodGuards).toEqual([AuthGuard, PermissionsGuard]);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['manage-students']);
    }

    for (const methodName of ['update', 'correctNationalId']) {
      const updateHandler = handlerOf(methodName);
      expect(Reflect.getMetadata(GUARDS_METADATA, updateHandler)).toEqual([
        AuthGuard,
        PermissionsGuard,
      ]);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, updateHandler)).toEqual(['manage-students']);
    }
  });

  it('separates directory reads, classroom profile reads, and management writes', () => {
    for (const methodName of ['findAll', 'getFilterOptions', 'findCasesByName']) {
      expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handlerOf(methodName))).toEqual([
        'students',
        'manage-students',
      ]);
    }

    for (const methodName of [
      'findOne',
      'findCasesByStudentId',
      'findAttendanceByStudentId',
      'getStudentProfileSummary',
      'getStudentSubjectAttendance',
    ]) {
      expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handlerOf(methodName))).toEqual([
        'students',
        'manage-students',
        'classrooms',
      ]);
    }

    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handlerOf('updateStudentPhoto'))).toEqual([
      'students',
      'manage-students',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handlerOf('revealPii'))).toEqual([
      'manage-students',
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handlerOf('getManagementOptions'))).toEqual([
      'manage-students',
    ]);
  });

  it('serves a student avatar to every page that shows one', () => {
    // The owner's rule (2026-08-17): a control that appears on several pages is
    // reachable from each of them. Avatars sit on เช็กชื่อ, ห้องเรียนทั้งหมด,
    // รายงานสถานะนักเรียน and เคส as well as รายชื่อนักเรียน, so pinning this to
    // `students` alone would leave those rosters full of broken images.
    const handler = handlerOf('getStudentPhoto');

    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler)).toEqual([
      'students',
      'manage-students',
      'attendance',
      'classrooms',
      'dashboard',
      'manage-school-structure',
    ]);
  });
});
