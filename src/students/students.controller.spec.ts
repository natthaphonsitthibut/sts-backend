import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { StudentsController } from './students.controller';

describe('StudentsController', () => {
  it('protects student write routes with the edit-students permission', () => {
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, StudentsController) as unknown[];

    expect(classGuards).toEqual([AuthGuard]);
    for (const methodName of ['create', 'update', 'remove']) {
      const handler = Object.getOwnPropertyDescriptor(StudentsController.prototype, methodName)
        ?.value as () => unknown;
      const methodGuards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];

      expect(methodGuards).toEqual([AuthGuard, PermissionsGuard]);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['edit-students']);
    }
  });
});
