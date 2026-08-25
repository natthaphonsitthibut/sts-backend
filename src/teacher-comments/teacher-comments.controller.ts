import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { PaginatedSearchQueryDto } from '../common/pagination/pagination.dto';
import { TeacherCommentsService } from './teacher-comments.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('students')
@Controller('api/student-risk-report/teacher-comments')
export class TeacherCommentReportsController {
  constructor(private readonly service: TeacherCommentsService) {}

  @Get()
  list(@Query() query: PaginatedSearchQueryDto, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.listComments(query, actor);
  }
}

// Teacher comments on a student are written from รายชื่อนักเรียน, ห้องเรียนทั้งหมด
// and เช็กชื่อ, so each of those pages can reach them.
@UseGuards(AuthGuard, PermissionsGuard)
@RequireAnyPermission('students', 'classrooms', 'manage-school-structure', 'attendance')
@Controller('api/students/:studentTermId/classroom-comments')
export class StudentClassroomCommentsController {
  constructor(private readonly service: TeacherCommentsService) {}

  @Get()
  list(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listStudentComments(studentTermId, actor);
  }
}
