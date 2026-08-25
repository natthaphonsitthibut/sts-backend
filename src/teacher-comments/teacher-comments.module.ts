import { Module } from '@nestjs/common';
import {
  StudentClassroomCommentsController,
  TeacherCommentReportsController,
} from './teacher-comments.controller';
import { TeacherCommentsRepository } from './teacher-comments.repository';
import { TeacherCommentsService } from './teacher-comments.service';

@Module({
  controllers: [TeacherCommentReportsController, StudentClassroomCommentsController],
  providers: [TeacherCommentsRepository, TeacherCommentsService],
  exports: [TeacherCommentsService],
})
export class TeacherCommentsModule {}
