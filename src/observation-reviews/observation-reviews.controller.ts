import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  Public,
  RequireAnyPermission,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { ThrottleTeacherAccess } from '../config/throttle.decorators';
import { TEACHER_ACCESS_TOKEN_HEADER } from '../teacher-access/teacher-access.constants';
import {
  CreateFollowUpRequestDto,
  CreatePublicFollowUpRequestDto,
  CreateRiskReviewDto,
  ListFollowUpRequestsQueryDto,
  ListHomeVisitRequestsQueryDto,
  ListTeacherObservationReportsQueryDto,
  ListTeacherWatchlistQueryDto,
  PublicFollowUpRequestsQueryDto,
  ReviewFollowUpRequestDto,
} from './dto/observation-reviews.dto';
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
@Controller('api/student-risk-report/teacher-reports')
export class TeacherObservationReportsController {
  constructor(private readonly service: ObservationReviewsService) {}

  @Get()
  list(
    @Query() query: ListTeacherObservationReportsQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listTeacherObservationReports(query, actor);
  }

  @Get(':observationId')
  detail(
    @Param('observationId', ParseIntPipe) observationId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.getTeacherObservationReport(String(observationId), actor);
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
@Controller('api/student-risk-report/home-visit-requests')
export class HomeVisitRequestReportsController {
  constructor(private readonly service: ObservationReviewsService) {}

  @Get()
  list(
    @Query() query: ListHomeVisitRequestsQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listHomeVisitRequests(query, actor);
  }

  @Get(':requestId')
  detail(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.getHomeVisitRequest(requestId, actor);
  }
}

@UseGuards(AuthGuard, PermissionsGuard)
@RequireAnyPermission('student-observations', 'manage-student-observations')
@Controller('api/students/:studentTermId/follow-up-requests')
export class StudentFollowUpRequestsController {
  constructor(private readonly service: ObservationReviewsService) {}

  @Post()
  create(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @Body() body: CreateFollowUpRequestDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.createFollowUp(studentTermId, body, actor);
  }

  @Get()
  list(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @Query() query: ListFollowUpRequestsQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listFollowUps(studentTermId, query, actor);
  }

  @Patch(':requestId')
  @RequirePermission('manage-student-observations')
  review(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() body: ReviewFollowUpRequestDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.reviewFollowUp(studentTermId, requestId, body, actor);
  }
}

@Public()
@Controller('api/teacher-access/follow-up-requests')
export class PublicStudentFollowUpRequestsController {
  constructor(private readonly service: ObservationReviewsService) {}

  private token(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] || '' : value || '';
  }

  @Post()
  @ThrottleTeacherAccess()
  create(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Body() body: CreatePublicFollowUpRequestDto,
  ) {
    return this.service.createFollowUpWithTeacherAccess(
      this.token(rawToken),
      body.studentTermId,
      body,
    );
  }

  @Get()
  @ThrottleTeacherAccess()
  list(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Query() query: PublicFollowUpRequestsQueryDto,
  ) {
    return this.service.listFollowUpsWithTeacherAccess(
      this.token(rawToken),
      query.studentTermId,
      query.assignmentId,
      query,
    );
  }
}
