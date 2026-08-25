import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { ANY_PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { TeacherProfilesController } from './teacher-profiles.controller';

describe('TeacherProfilesController access', () => {
  it('accepts either teacher management or classroom-link page permission', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, TeacherProfilesController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, TeacherProfilesController)).toEqual([
      'teachers',
      'manage-teachers',
      'manage-classroom-links',
    ]);
  });
});
