import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { CaseController } from './case.controller';

describe('CaseController', () => {
  it.each(['openCase', 'getCase'])('%s requires review-cases permission', (methodName) => {
    const handler = Object.getOwnPropertyDescriptor(CaseController.prototype, methodName)
      ?.value as () => unknown;

    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([AuthGuard, PermissionsGuard]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['review-cases']);
  });
});
