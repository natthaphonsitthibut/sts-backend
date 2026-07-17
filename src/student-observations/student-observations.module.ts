import { Module } from '@nestjs/common';
import { TeacherAccessModule } from '../teacher-access/teacher-access.module';
import { TaskModule } from '../task/task.module';
import {
  PublicStudentObservationsController,
  PublicTaskLinkStudentObservationsController,
  StudentObservationCatalogController,
  StudentObservationsController,
} from './student-observations.controller';
import { StudentObservationsRepository } from './student-observations.repository';
import { StudentObservationsService } from './student-observations.service';

@Module({
  imports: [TeacherAccessModule, TaskModule],
  controllers: [
    StudentObservationsController,
    StudentObservationCatalogController,
    PublicStudentObservationsController,
    PublicTaskLinkStudentObservationsController,
  ],
  providers: [StudentObservationsRepository, StudentObservationsService],
  exports: [StudentObservationsService],
})
export class StudentObservationsModule {}
