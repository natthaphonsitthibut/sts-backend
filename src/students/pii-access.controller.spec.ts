import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { ANY_PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { PiiAccessController } from './pii-access.controller';

describe('PiiAccessController', () => {
  it('serves the central staff reason catalog to every PII-capable page', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PiiAccessController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, PiiAccessController)).toEqual([
      'students',
      'manage-students',
      'teachers',
      'manage-teachers',
      'manage-users-list',
    ]);
    const response = new PiiAccessController().listRevealOptions();
    expect(response.data.some((option) => option.value === 'OTHER' && option.requiresNote)).toBe(
      true,
    );
  });
});
