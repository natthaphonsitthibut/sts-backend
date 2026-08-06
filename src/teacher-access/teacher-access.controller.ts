import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '../common/interceptors/file-upload.interceptor';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  Public,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { resolveExternalBaseUrl } from '../common/utils/request-url';
import { appConfig } from '../config/app.config';
import { ThrottleTeacherAccess } from '../config/throttle.decorators';
import {
  CreateTeacherAccessStudentCommentDto,
  IssueTeacherAccessGrantDto,
  RecordTeacherAccessExportDto,
  IssueTeacherAccessGrantsForTermDto,
  ListTeacherAccessGrantsDto,
  ListTeacherLinkRosterDto,
  RevokeTeacherAccessGrantDto,
  SendTeacherAccessGrantsDto,
  SaveTeacherAccessAttendanceDto,
  TeacherAccessAttendanceSlotsQueryDto,
  TeacherAccessAssignmentOptionsDto,
  TeacherAccessAttendanceHistoryQueryDto,
  TeacherAccessRosterQueryDto,
  TeacherAccessAssignmentQueryDto,
  TeacherAccessStudentProfileQueryDto,
  TeacherAccessStudentSubjectAttendanceQueryDto,
  UpdateTeacherAccessClassroomCardDto,
  VerifyTeacherAccessOtpDto,
} from './dto/teacher-access.dto';
import {
  TEACHER_ACCESS_SESSION_HEADER,
  TEACHER_ACCESS_TOKEN_HEADER,
} from './teacher-access.constants';
import { TeacherAccessService } from './teacher-access.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('manage-teacher-access')
@Controller('api/teacher-access-grants')
export class TeacherAccessGrantController {
  constructor(
    private readonly service: TeacherAccessService,
    @Inject(appConfig.KEY)
    private readonly runtimeConfig: ConfigType<typeof appConfig>,
  ) {}

  @Post()
  issue(
    @Body() body: IssueTeacherAccessGrantDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.issueGrant(body, actor, baseUrl);
  }

  @Post('bulk')
  issueForTerm(
    @Body() body: IssueTeacherAccessGrantsForTermDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.issueGrantsForTerm(body, actor);
  }

  @Post('send-line')
  sendOverLine(
    @Body() body: SendTeacherAccessGrantsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.sendGrantsOverMessaging(body, actor, baseUrl);
  }

  @Get()
  list(@Query() query: ListTeacherAccessGrantsDto, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.listGrants(query, actor);
  }

  @Get('teacher-roster')
  teacherRoster(
    @Query() query: ListTeacherLinkRosterDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listTeacherLinkRoster(query, actor);
  }

  @Get('assignment-options')
  assignmentOptions(
    @Query() query: TeacherAccessAssignmentOptionsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listAssignmentOptions(query, actor);
  }

  @Get(':grantId')
  detail(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.getGrant(grantId, actor);
  }

  @Get(':grantId/link')
  link(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.getGrantLink(grantId, actor, baseUrl);
  }

  @Post(':grantId/revoke')
  revoke(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() body: RevokeTeacherAccessGrantDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.revokeGrant(grantId, body.reason, actor);
  }

  @Post(':grantId/rotate')
  rotate(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.rotateGrant(grantId, actor, baseUrl);
  }
}

@Public()
@Controller('api/teacher-access')
export class PublicTeacherAccessController {
  constructor(private readonly service: TeacherAccessService) {}

  private token(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] || '' : value || '';
  }

  private session(value: string | string[] | undefined): string | undefined {
    return this.token(value) || undefined;
  }

  @Post('otp/request')
  @ThrottleTeacherAccess()
  requestOtp(@Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken?: string | string[]) {
    return this.service.requestOtp(this.token(rawToken));
  }

  @Post('otp/verify')
  @ThrottleTeacherAccess()
  verifyOtp(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Body() body: VerifyTeacherAccessOtpDto,
  ) {
    return this.service.verifyOtp(this.token(rawToken), body.otp);
  }

  @Get('context')
  @ThrottleTeacherAccess()
  context(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken?: string | string[],
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession?: string | string[],
  ) {
    return this.service.getPublicContext(this.token(rawToken), this.session(rawSession));
  }

  @Get('attendance-slots')
  @ThrottleTeacherAccess()
  attendanceSlots(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Query() query: TeacherAccessAttendanceSlotsQueryDto,
  ) {
    return this.service.listPublicAttendanceSlots(
      this.token(rawToken),
      query,
      this.session(rawSession),
    );
  }

  @Get('roster')
  @ThrottleTeacherAccess()
  roster(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Query() query: TeacherAccessRosterQueryDto,
  ) {
    return this.service.listPublicRoster(
      this.token(rawToken),
      query.assignmentId,
      query.searchTerm?.trim() || undefined,
      query.page,
      query.limit,
      this.session(rawSession),
    );
  }

  @Get('attendance-history')
  @ThrottleTeacherAccess()
  attendanceHistory(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Query() query: TeacherAccessAttendanceHistoryQueryDto,
  ) {
    return this.service.listPublicAttendanceHistory(
      this.token(rawToken),
      query,
      this.session(rawSession),
    );
  }

  @Post('export-events')
  @ThrottleTeacherAccess()
  recordExport(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Body() body: RecordTeacherAccessExportDto,
  ) {
    return this.service.recordPublicClassroomExport(
      this.token(rawToken),
      body,
      this.session(rawSession),
    );
  }

  @Post('student-comments')
  @ThrottleTeacherAccess()
  createStudentComment(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Body() body: CreateTeacherAccessStudentCommentDto,
  ) {
    return this.service.createPublicStudentComment(
      this.token(rawToken),
      body,
      this.session(rawSession),
    );
  }

  @Patch('classroom-cover')
  @ThrottleTeacherAccess()
  @UseInterceptors(FileInterceptor('photo', multerConfig))
  updateClassroomCard(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Body() body: UpdateTeacherAccessClassroomCardDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.service.updatePublicClassroomPresentation(
      this.token(rawToken),
      body,
      file,
      this.session(rawSession),
    );
  }

  @Get('my-schedule')
  @ThrottleTeacherAccess()
  mySchedule(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
  ) {
    return this.service.getPublicTeacherSchedule(this.token(rawToken), this.session(rawSession));
  }

  @Get('student-profile')
  @ThrottleTeacherAccess()
  studentProfile(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Query() query: TeacherAccessStudentProfileQueryDto,
  ) {
    return this.service.getPublicStudentProfile(
      this.token(rawToken),
      query,
      this.session(rawSession),
    );
  }

  @Get('student-subject-attendance')
  @ThrottleTeacherAccess()
  studentSubjectAttendance(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Query() query: TeacherAccessStudentSubjectAttendanceQueryDto,
  ) {
    return this.service.getPublicStudentSubjectAttendance(
      this.token(rawToken),
      query,
      this.session(rawSession),
    );
  }

  @Get('classroom-cover')
  @ThrottleTeacherAccess()
  async classroomCover(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Query() query: TeacherAccessAssignmentQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.service.resolvePublicClassroomCover(
      this.token(rawToken),
      query.assignmentId,
      this.session(rawSession),
    );
    // Do not cache a redirect to a short-lived Supabase signed URL.
    res.setHeader('Cache-Control', 'private, no-store');
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    res.sendFile(result.filePath);
  }

  @Post('attendance')
  @ThrottleTeacherAccess()
  attendance(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Body() body: SaveTeacherAccessAttendanceDto,
  ) {
    return this.service.savePublicAttendance(this.token(rawToken), body, this.session(rawSession));
  }
}
