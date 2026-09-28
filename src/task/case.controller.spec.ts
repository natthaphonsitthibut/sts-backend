import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { CaseController } from './case.controller';

describe('CaseController', () => {
  it.each([
    ['getCase', 'dashboard'],
    ['getCaseTasks', 'dashboard'],
    ['getCaseReviews', 'dashboard'],
    ['openCase', 'case:assign'],
    ['sendRoundLine', 'case:assign'],
    ['cancelCaseAssignment', 'case:assign'],
    ['reviewCase', 'case:review'],
  ])('%s requires %s', (methodName, permission) => {
    const handler = Object.getOwnPropertyDescriptor(CaseController.prototype, methodName)
      ?.value as () => unknown;

    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([AuthGuard, PermissionsGuard]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual([permission]);
  });
});
