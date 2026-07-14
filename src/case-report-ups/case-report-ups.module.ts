import { Module } from '@nestjs/common';
import { AuthModule } from '../auth';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  CaseReportUpMutationController,
  CaseReportUpQueueController,
} from './case-report-ups.controller';
import { CaseReportUpsRepository } from './case-report-ups.repository';
import { CaseReportUpsService } from './case-report-ups.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [CaseReportUpMutationController, CaseReportUpQueueController],
  providers: [CaseReportUpsRepository, CaseReportUpsService],
  exports: [CaseReportUpsService],
})
export class CaseReportUpsModule {}
