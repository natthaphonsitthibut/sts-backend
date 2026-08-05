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
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import {} from '../teacher-access/teacher-access.constants';
import { CreateRiskReviewDto, ListTeacherWatchlistQueryDto } from './dto/observation-reviews.dto';
import { PaginatedSearchQueryDto } from '../common/pagination/pagination.dto';
import { ObservationReviewsService } from './observation-reviews.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('manage-student-observations')
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
@RequirePermission('manage-student-observations')
@Controller('api/student-risk-report/teacher-comments')
export class TeacherCommentReportsController {
  constructor(private readonly service: ObservationReviewsService) {}

  @Get()
  list(@Query() query: PaginatedSearchQueryDto, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.listClassroomComments(query, actor);
  }
}

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('review-cases', 'manage-student-observations')
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

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('manage-student-observations')
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
