import { Module } from '@nestjs/common';
import { TokenEncryptionModule } from '../common/crypto/token-encryption.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TaskService } from './task.service';
import { TaskController } from './task.controller';
import { AdminController } from './admin.controller';
import { StatsController } from './stats.controller';
import { SubmissionController } from './submission.controller';
import { EmailModule } from '../common/email/email.module';
import { CaseController } from './case.controller';
import { CaseService } from './case.service';
import { AutomationModule } from '../automation/automation.module';
import { TaskRepository } from './task.repository';
import { TaskPolicyService } from './task-policy.service';
import { TaskLifecycleService } from './task-lifecycle.service';
import { TaskAccessService } from './task-access.service';
import { TaskReadService } from './task-read.service';
import { TaskSubmissionService } from './task-submission.service';
import { TaskStatsService } from './task-stats.service';
import { AttendanceModule } from '../attendance/attendance.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import { CaseTrackingOptionsController } from './case-tracking-options.controller';
import { CaseTrackingOptionsService } from './case-tracking-options.service';

@Module({
  imports: [
    AutomationModule,
    AttendanceModule,
    NotificationsModule,
    RiskProfileModule,
    TokenEncryptionModule,
    EmailModule,
  ],
  controllers: [
    TaskController,
    AdminController,
    StatsController,
    SubmissionController,
    CaseController,
    CaseTrackingOptionsController,
  ],
  providers: [
    TaskRepository,
    TaskPolicyService,
    TaskLifecycleService,
    TaskAccessService,
    TaskReadService,
    TaskSubmissionService,
    TaskStatsService,
    TaskService,
    CaseService,
    CaseTrackingOptionsService,
  ],
  exports: [TaskService, CaseService, TaskPolicyService, TaskAccessService, TaskRepository],
})
export class TaskModule {}
