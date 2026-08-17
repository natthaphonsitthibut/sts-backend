import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import {} from '../teacher-access/teacher-access.constants';
import { CreateRiskReviewDto, ListTeacherWatchlistQueryDto } from './dto/observation-reviews.dto';
import { PaginatedSearchQueryDto } from '../common/pagination/pagination.dto';
import { ObservationReviewsService } from './observation-reviews.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('students')
@Controller('api/students/:studentTermId/risk-review')
export class StudentRiskReviewController {
  constructor(private readonly service: ObservationReviewsService) {}

  @Post()
  create(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @Body() body: CreateRiskReviewDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.createRiskReview(studentTermId, body, actor);
  }

  @Get()
  getLatest(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.getLatestRiskReview(studentTermId, actor);
  }
}

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('students')
@Controller('api/student-risk-report/teacher-comments')
export class TeacherCommentReportsController {
  constructor(private readonly service: ObservationReviewsService) {}

  @Get()
  list(@Query() query: PaginatedSearchQueryDto, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.listClassroomComments(query, actor);
  }
}

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('dashboard', 'students')
@Controller('api/student-risk-report/teacher-watchlist')
export class TeacherWatchlistController {
  constructor(private readonly service: ObservationReviewsService) {}

  @Get()
  list(
    @Query() query: ListTeacherWatchlistQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listTeacherWatchlist(query, actor);
  }
}

// Teacher comments on a student are written from รายชื่อนักเรียน, ห้องเรียนทั้งหมด
// and เช็กชื่อ, so each of those pages can reach them.
@UseGuards(AuthGuard, PermissionsGuard)
@RequireAnyPermission('students', 'classrooms', 'manage-school-structure', 'attendance')
@Controller('api/students/:studentTermId/classroom-comments')
export class StudentClassroomCommentsController {
  constructor(private readonly service: ObservationReviewsService) {}

  @Get()
  list(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listStudentClassroomComments(studentTermId, actor);
  }
}
