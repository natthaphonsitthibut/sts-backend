import { forwardRef, Module } from '@nestjs/common';
import { TeacherAccessModule } from '../teacher-access/teacher-access.module';
import { TaskModule } from '../task/task.module';
import { RiskProfileModule } from '../risk-profile/risk-profile.module';
import {
  StudentObservationCatalogController,
  StudentObservationsController,
} from './student-observations.controller';
import { StudentObservationsRepository } from './student-observations.repository';
import { StudentObservationsService } from './student-observations.service';

@Module({
  imports: [forwardRef(() => TeacherAccessModule), TaskModule, RiskProfileModule],
  controllers: [StudentObservationsController, StudentObservationCatalogController],
  providers: [StudentObservationsRepository, StudentObservationsService],
  exports: [StudentObservationsService],
})
export class StudentObservationsModule {}
