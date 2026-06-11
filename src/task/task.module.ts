import { Module } from '@nestjs/common';
import { TaskService } from './task.service';
import { TaskController } from './task.controller';
import { AdminController } from './admin.controller';
import { StatsController } from './stats.controller';
import { DelegationController } from './delegation.controller';
import { DelegationService } from './delegation.service';
import { SubmissionController } from './submission.controller';
import { EmailService } from './email.service';
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

@Module({
  imports: [AutomationModule],
  controllers: [
    TaskController,
    AdminController,
    StatsController,
    DelegationController,
    SubmissionController,
    CaseController,
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
    DelegationService,
    EmailService,
    CaseService,
  ],
  exports: [TaskService, DelegationService, EmailService, CaseService],
})
export class TaskModule {}
