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
import { PaginationQueryDto } from '../common/pagination/pagination.dto';
import {
  TEACHER_ACCESS_SESSION_HEADER,
  TEACHER_ACCESS_TOKEN_HEADER,
} from '../teacher-access/teacher-access.constants';
import {
  CreatePublicStudentObservationDto,
  CreateStudentObservationDto,
  ListStudentObservationsQueryDto,
  PublicStudentObservationQueryDto,
  PublicObservationRevisionsQueryDto,
  UpdateObservationCatalogItemDto,
  UpdatePublicStudentObservationDto,
  UpdateStudentObservationDto,
} from './dto/student-observations.dto';
import { StudentObservationsService } from './student-observations.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequireAnyPermission('students')
@Controller('api/students/:studentTermId/observations')
export class StudentObservationsController {
  constructor(private readonly service: StudentObservationsService) {}

  @Post()
  create(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @Body() body: CreateStudentObservationDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.create(studentTermId, body, actor);
  }

  @Get()
  list(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @Query() query: ListStudentObservationsQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.list(studentTermId, query, actor);
  }

  @Patch(':observationId')
  update(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @Param('observationId', ParseIntPipe) observationId: number,
    @Body() body: UpdateStudentObservationDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.update(studentTermId, String(observationId), body, actor);
  }

  @Get(':observationId/revisions')
  revisions(
    @Param('studentTermId', ParseUUIDPipe) studentTermId: string,
    @Param('observationId', ParseIntPipe) observationId: number,
    @Query() query: PaginationQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listRevisions(studentTermId, String(observationId), query, actor);
  }
}

@UseGuards(AuthGuard, PermissionsGuard)
@RequireAnyPermission('students')
@Controller('api/student-observations/catalog')
export class StudentObservationCatalogController {
  constructor(private readonly service: StudentObservationsService) {}

  @Get()
  list(@CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.getCatalog(actor);
  }

  @Patch('dimensions/:id')
  @RequirePermission('students')
  updateDimension(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateObservationCatalogItemDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.updateDimension(id, body, actor);
  }

  @Patch('tags/:id')
  @RequirePermission('students')
  updateTag(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateObservationCatalogItemDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.updateTag(id, body, actor);
  }
}

@Public()
@Controller('api/teacher-access/observations')
export class PublicStudentObservationsController {
  constructor(private readonly service: StudentObservationsService) {}

  private token(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] || '' : value || '';
  }

  private session(value: string | string[] | undefined): string | undefined {
    return this.token(value) || undefined;
  }

  @Get('catalog')
  @ThrottleTeacherAccess()
  catalog(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
  ) {
    return this.service.getCatalogWithTeacherAccess(this.token(rawToken), this.session(rawSession));
  }

  @Post()
  @ThrottleTeacherAccess()
  create(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Body() body: CreatePublicStudentObservationDto,
  ) {
    return this.service.createWithTeacherAccess(
      this.token(rawToken),
      body.studentTermId,
      body,
      this.session(rawSession),
    );
  }

  @Get()
  @ThrottleTeacherAccess()
  list(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Query() query: PublicStudentObservationQueryDto,
  ) {
    return this.service.listWithTeacherAccess(
      this.token(rawToken),
      query.studentTermId,
      query.assignmentId,
      query,
      this.session(rawSession),
    );
  }

  @Patch(':observationId')
  @ThrottleTeacherAccess()
  update(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Param('observationId', ParseIntPipe) observationId: number,
    @Body() body: UpdatePublicStudentObservationDto,
  ) {
    return this.service.updateWithTeacherAccess(
      this.token(rawToken),
      body.studentTermId,
      String(observationId),
      body.assignmentId,
      body,
      this.session(rawSession),
    );
  }

  @Get(':observationId/revisions')
  @ThrottleTeacherAccess()
  revisions(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Param('observationId', ParseIntPipe) observationId: number,
    @Query() query: PublicObservationRevisionsQueryDto,
  ) {
    return this.service.listRevisionsWithTeacherAccess(
      this.token(rawToken),
      query.studentTermId,
      String(observationId),
      query.assignmentId,
      query,
      this.session(rawSession),
    );
  }
}
