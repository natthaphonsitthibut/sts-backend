import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { StudentsController } from './students.controller';

describe('StudentsController', () => {
  it('protects student write routes with the edit-students permission', () => {
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, StudentsController) as unknown[];

    expect(classGuards).toEqual([AuthGuard, PermissionsGuard]);
    for (const methodName of ['create', 'remove']) {
      const handler = Object.getOwnPropertyDescriptor(StudentsController.prototype, methodName)
        ?.value as () => unknown;
      const methodGuards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];

      expect(methodGuards).toEqual([AuthGuard, PermissionsGuard]);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['edit-students']);
    }

    // update additionally admits student-self: an own-only student may edit
    // their contact/guardian fields (the service rejects everything else).
    const updateHandler = Object.getOwnPropertyDescriptor(StudentsController.prototype, 'update')
      ?.value as () => unknown;
    expect(Reflect.getMetadata(GUARDS_METADATA, updateHandler)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, updateHandler)).toEqual([
      'edit-students',
      'student-self',
    ]);
  });

  it('requires staff student access for raw lists while preserving scoped student self detail', () => {
    for (const methodName of ['findAll', 'getFilterOptions', 'findCasesByName']) {
      const handler = Object.getOwnPropertyDescriptor(StudentsController.prototype, methodName)
        ?.value as () => unknown;
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['students']);
    }

    for (const methodName of ['findOne', 'findAttendanceByStudentId']) {
      const handler = Object.getOwnPropertyDescriptor(StudentsController.prototype, methodName)
        ?.value as () => unknown;
      expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, handler)).toEqual([
        'students',
        'student-self',
      ]);
    }
  });
});
