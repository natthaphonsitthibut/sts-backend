import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { MasterDataController } from './master-data.controller';

function handler(name: string): () => unknown {
  return Object.getOwnPropertyDescriptor(MasterDataController.prototype, name)
    ?.value as () => unknown;
}

describe('MasterDataController access', () => {
  it('guards every route and separates school management from settings', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, MasterDataController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    for (const method of [
      'listSchools',
      'getSchool',
      'createSchool',
      'updateSchool',
      'disableSchool',
    ]) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler(method))).toEqual(['manage-schools']);
    }
    for (const method of ['getAll', 'getById', 'create', 'update', 'remove']) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, handler(method))).toEqual(['settings']);
    }
  });
});
