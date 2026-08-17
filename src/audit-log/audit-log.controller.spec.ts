import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { ANY_PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { AuditLogController } from './audit-log.controller';

describe('AuditLogController', () => {
  it('opens the log to the pages that embed it, plus the standalone permission', () => {
    const listHandler = Object.getOwnPropertyDescriptor(AuditLogController.prototype, 'list')
      ?.value as () => unknown;
    const getByIdHandler = Object.getOwnPropertyDescriptor(AuditLogController.prototype, 'getById')
      ?.value as () => unknown;
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, AuditLogController) as unknown[];

    expect(classGuards).toEqual([AuthGuard, PermissionsGuard]);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, listHandler)).toEqual([
      'audit-log',
      'import-data',
      'students',
    ]);
    expect(Reflect.getMetadata(ANY_PERMISSIONS_KEY, getByIdHandler)).toEqual([
      'audit-log',
      'import-data',
      'students',
    ]);
  });
});
