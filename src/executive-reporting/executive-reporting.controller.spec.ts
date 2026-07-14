import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { ExecutiveReportingController } from './executive-reporting.controller';

describe('ExecutiveReportingController security metadata', () => {
  it('is authenticated, permission-gated and exposes only a read handler', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, ExecutiveReportingController)).toEqual([
      AuthGuard,
      PermissionsGuard,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ExecutiveReportingController)).toEqual([
      'executive-report',
    ]);
    expect(Object.getOwnPropertyNames(ExecutiveReportingController.prototype)).toEqual([
      'constructor',
      'getOverview',
    ]);
  });
});
