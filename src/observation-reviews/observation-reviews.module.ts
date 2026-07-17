import { Module } from '@nestjs/common';
import { TeacherAccessModule } from '../teacher-access/teacher-access.module';
import { TaskModule } from '../task/task.module';
import {
  PublicStudentFollowUpRequestsController,
  StudentFollowUpRequestsController,
  StudentRiskReviewController,
  TeacherObservationReportsController,
} from './observation-reviews.controller';
import { ObservationReviewsRepository } from './observation-reviews.repository';
import { ObservationReviewsService } from './observation-reviews.service';

@Module({
  imports: [TeacherAccessModule, TaskModule],
  controllers: [
    StudentRiskReviewController,
    StudentFollowUpRequestsController,
    PublicStudentFollowUpRequestsController,
    TeacherObservationReportsController,
  ],
  providers: [ObservationReviewsRepository, ObservationReviewsService],
  exports: [ObservationReviewsService],
})
export class ObservationReviewsModule {}
