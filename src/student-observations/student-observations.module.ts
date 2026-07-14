import { Module } from '@nestjs/common';
import { TeacherAccessModule } from '../teacher-access/teacher-access.module';
import {
  PublicStudentObservationsController,
  StudentObservationCatalogController,
  StudentObservationsController,
} from './student-observations.controller';
import { StudentObservationsRepository } from './student-observations.repository';
import { StudentObservationsService } from './student-observations.service';

@Module({
  imports: [TeacherAccessModule],
  controllers: [
    StudentObservationsController,
    StudentObservationCatalogController,
    PublicStudentObservationsController,
  ],
  providers: [StudentObservationsRepository, StudentObservationsService],
  exports: [StudentObservationsService],
})
export class StudentObservationsModule {}
