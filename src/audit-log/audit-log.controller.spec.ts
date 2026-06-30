import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard, PermissionsGuard } from '../auth';
import { PERMISSIONS_KEY } from '../auth/permissions.decorator';
import { AuditLogController } from './audit-log.controller';

describe('AuditLogController', () => {
  it('protects list and detail routes with the audit-log permission', () => {
    const listHandler = Object.getOwnPropertyDescriptor(AuditLogController.prototype, 'list')
      ?.value as () => unknown;
    const getByIdHandler = Object.getOwnPropertyDescriptor(AuditLogController.prototype, 'getById')
      ?.value as () => unknown;
    const classGuards = Reflect.getMetadata(GUARDS_METADATA, AuditLogController) as unknown[];

    expect(classGuards).toEqual([AuthGuard, PermissionsGuard]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, listHandler)).toEqual(['audit-log']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, getByIdHandler)).toEqual(['audit-log']);
  });
});
