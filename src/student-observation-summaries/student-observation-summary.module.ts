import { Module } from '@nestjs/common';
import {
  DisabledObservationSummaryAdapter,
  OBSERVATION_SUMMARY_ADAPTER,
} from './observation-summary.adapter';
import { StudentObservationSummaryController } from './student-observation-summary.controller';
import { StudentObservationSummaryRepository } from './student-observation-summary.repository';
import { StudentObservationSummaryService } from './student-observation-summary.service';

@Module({
  controllers: [StudentObservationSummaryController],
  providers: [
    StudentObservationSummaryRepository,
    StudentObservationSummaryService,
    DisabledObservationSummaryAdapter,
    { provide: OBSERVATION_SUMMARY_ADAPTER, useExisting: DisabledObservationSummaryAdapter },
  ],
})
export class StudentObservationSummaryModule {}
