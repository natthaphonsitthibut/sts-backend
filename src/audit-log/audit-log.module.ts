import { Global, Module } from '@nestjs/common';
import { AuditLogService } from './audit-log.service';

/**
 * Global so any feature service can inject AuditLogService without each module
 * re-importing it — audit logging is a cross-cutting concern. Registered once
 * in AppModule.
 */
@Global()
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
