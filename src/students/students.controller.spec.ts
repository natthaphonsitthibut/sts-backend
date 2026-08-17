import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { StudentsController } from './students.controller';

function handlerOf(methodName: string): () => unknown {
  return Object.getOwnPropertyDescriptor(StudentsController.prototype, methodName)
    ?.value as () => unknown;
}

describe('StudentsController', () => {
  it('protects student write routes with the รายชื่อนักเรียน page permission', () => {
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, StudentsController) as unknown[];

    expect(classGuards).toEqual([AuthGuard, PermissionsGuard]);
    for (const methodName of ['create', 'remove']) {
      const handler = handlerOf(methodName);
      const methodGuards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];

      expect(methodGuards).toEqual([AuthGuard, PermissionsGuard]);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['students']);
    }

    const updateHandler = handlerOf('update');
    expect(Reflect.getMetadata(GUARDS_METADATA, updateHandler)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, updateHandler)).toEqual(['students']);
  });

  it('requires staff student access for every student endpoint', () => {
    for (const methodName of [
      'findAll',
      'getFilterOptions',
      'findCasesByName',
      'findCasesByStudentId',
    ]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handlerOf(methodName))).toEqual(['students']);
    }

    for (const methodName of [
      'findOne',
      'findAttendanceByStudentId',
      'getStudentProfileSummary',
      'getStudentSubjectAttendance',
      'updateStudentPhoto',
      'revealPii',
    ]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handlerOf(methodName))).toEqual(['students']);
    }
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
      'attendance',
      'classrooms',
      'dashboard',
      'manage-school-structure',
    ]);
  });
});
