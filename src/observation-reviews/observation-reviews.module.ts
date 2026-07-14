import { Module } from '@nestjs/common';
import { TeacherAccessModule } from '../teacher-access/teacher-access.module';
import {
  PublicStudentFollowUpRequestsController,
  StudentFollowUpRequestsController,
  StudentRiskReviewController,
} from './observation-reviews.controller';
import { ObservationReviewsRepository } from './observation-reviews.repository';
import { ObservationReviewsService } from './observation-reviews.service';

@Module({
  imports: [TeacherAccessModule],
  controllers: [
    StudentRiskReviewController,
    StudentFollowUpRequestsController,
    PublicStudentFollowUpRequestsController,
  ],
  providers: [ObservationReviewsRepository, ObservationReviewsService],
  exports: [ObservationReviewsService],
})
export class ObservationReviewsModule {}
