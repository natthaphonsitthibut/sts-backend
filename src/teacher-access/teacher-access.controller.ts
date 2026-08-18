import {
  Body,
  Controller,
  Get,
  GoneException,
  Headers,
  Inject,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { multerConfig } from '../common/interceptors/file-upload.interceptor';
import { attendanceImportMulterOptions } from '../attendance/attendance-import.multer';
import { ParsePublicAttendanceImportDto } from '../attendance/dto/attendance-import.dto';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  Public,
  RequireAnyPermission,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { resolveExternalBaseUrl } from '../common/utils/request-url';
import { AraIdSessionCookieService } from '../araid/araid-session-cookie.service';
import { appConfig } from '../config/app.config';
import { ThrottleTeacherAccess } from '../config/throttle.decorators';
import {
  CreateTeacherAccessStudentCommentDto,
  IssuePublicTeacherAccessAttendanceDelegationDto,
  IssueTeacherAccessAttendanceDelegationDto,
  IssueTeacherAccessGrantDto,
  IssueTeacherAccessGrantsForTermDto,
  IssueTeacherLineGroupInvitationDto,
  ListPublicTeacherAccessDelegationHistoryDto,
  ListPublicTeacherAccessImportsDto,
  ListTeacherAccessDelegationHistoryDto,
  ListTeacherAccessGrantsDto,
  ListTeacherLinkRosterDto,
  PublicTeacherAccessAttendanceDelegationOptionsDto,
  RecordPublicTeacherAccessImportDto,
  RecordTeacherAccessExportDto,
  RevokePublicTeacherAccessAttendanceDelegationDto,
  RevokeTeacherAccessGrantDto,
  SaveTeacherAccessAttendanceDto,
  SaveTeacherAccessAttendanceMarksDto,
  SendTeacherAccessGrantsDto,
  TeacherAccessAssignmentOptionsDto,
  TeacherAccessAssignmentQueryDto,
  TeacherAccessAttendanceDelegationOptionsDto,
  TeacherAccessAttendanceHistoryQueryDto,
  TeacherAccessAttendanceSessionQueryDto,
  TeacherAccessAttendanceSlotsQueryDto,
  TeacherAccessRosterQueryDto,
  TeacherAccessStudentProfileQueryDto,
  TeacherAccessStudentSubjectAttendanceQueryDto,
  UpdatePublicTeacherAccessAttendanceDelegationDto,
  UpdateTeacherAccessAttendanceDelegationDto,
  UpdateTeacherAccessClassroomCardDto,
  VerifyTeacherAccessOtpDto,
} from './dto/teacher-access.dto';
import {
  TEACHER_ACCESS_ARAID_CHALLENGE_HEADER,
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

  @Post('teacher-memberships/:teacherMembershipId/unlink-line')
  unlinkLine(
    @Param('teacherMembershipId', ParseIntPipe) teacherMembershipId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.unlinkTeacherLineAccount(teacherMembershipId, actor);
  }

  @Post('teacher-memberships/:teacherMembershipId/line-invitation')
  issueLineInvitation(
    @Param('teacherMembershipId', ParseIntPipe) teacherMembershipId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.issueTeacherLineInvitation(teacherMembershipId, actor, baseUrl);
  }

  @Post('line-group-invitation')
  issueLineGroupInvitation(
    @Body() body: IssueTeacherLineGroupInvitationDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.issueTeacherLineGroupInvitation(body, actor, baseUrl);
  }

  @Get('line-group-invitation')
  getLineGroupInvitation(
    @Query('schoolId', ParseIntPipe) schoolId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.getTeacherLineGroupInvitation(schoolId, actor, baseUrl);
  }

  @Patch('line-group-invitation/:invitationId')
  updateLineGroupInvitation(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Body() body: IssueTeacherLineGroupInvitationDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.updateTeacherLineGroupInvitation(invitationId, body, actor, baseUrl);
  }

  @Post('line-group-invitation/:invitationId/revoke')
  revokeLineGroupInvitation(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Query('schoolId', ParseIntPipe) schoolId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.revokeTeacherLineGroupInvitation(invitationId, schoolId, actor);
  }

  @Post('teacher-memberships/:teacherMembershipId/line-invitation/revoke')
  revokeLineInvitation(
    @Param('teacherMembershipId', ParseIntPipe) teacherMembershipId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.revokeTeacherLineInvitation(teacherMembershipId, actor);
  }

  @Get('teacher-memberships/:teacherMembershipId/photo')
  async teacherRosterPhoto(
    @Param('teacherMembershipId', ParseIntPipe) teacherMembershipId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.service.resolveTeacherRosterPhoto(teacherMembershipId, actor);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    res.sendFile(result.filePath);
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

  // Standing in for a colleague's check-in is offered from two screens — the
  // เช็กชื่อ page and จัดการลิงก์เช็กชื่อ — so these answer to either page's
  // permission instead of the controller-wide `manage-teacher-access`.
  @Get('attendance-delegation-options')
  @RequirePermission()
  @RequireAnyPermission('manage-teacher-access', 'attendance')
  attendanceDelegationOptions(
    @Query() query: TeacherAccessAttendanceDelegationOptionsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    return this.service.listAttendanceDelegationOptions(
      query,
      actor,
      resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl),
    );
  }

  @Get('attendance-delegation-history')
  @RequirePermission()
  @RequireAnyPermission('manage-teacher-access', 'attendance')
  attendanceDelegationHistory(
    @Query() query: ListTeacherAccessDelegationHistoryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    return this.service.listAttendanceDelegationHistory(
      query,
      actor,
      resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl),
    );
  }

  @Post('attendance-delegations')
  @RequirePermission()
  @RequireAnyPermission('manage-teacher-access', 'attendance')
  issueAttendanceDelegation(
    @Body() body: IssueTeacherAccessAttendanceDelegationDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.issueAttendanceDelegation(body, actor, baseUrl);
  }

  @Patch('attendance-delegations/:grantId')
  @RequirePermission()
  @RequireAnyPermission('manage-teacher-access', 'attendance')
  updateAttendanceDelegation(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() body: UpdateTeacherAccessAttendanceDelegationDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.updateAttendanceDelegation(grantId, body, actor, baseUrl);
  }

  @Post('attendance-delegations/:grantId/revoke')
  @RequirePermission()
  @RequireAnyPermission('manage-teacher-access', 'attendance')
  revokeAttendanceDelegation(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.revokeAttendanceDelegation(grantId, actor);
  }
}

@Public()
@Controller('api/teacher-access')
export class PublicTeacherAccessController {
  constructor(
    private readonly service: TeacherAccessService,
    private readonly araIdSessionCookie: AraIdSessionCookieService,
    @Inject(appConfig.KEY)
    private readonly runtimeConfig: ConfigType<typeof appConfig>,
  ) {}

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

  @Post('araid/verify')
  @ThrottleTeacherAccess()
  verifyAraId() {
    throw new GoneException('กรุณายืนยันผ่าน QR และ PIN AraID');
  }

  @Post('araid/challenge')
  @ThrottleTeacherAccess()
  createAraIdChallenge(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.createAraIdChallenge(this.token(rawToken), baseUrl);
  }

  @Post('araid/challenge/begin')
  @ThrottleTeacherAccess()
  async beginAraIdChallenge(
    @Headers(TEACHER_ACCESS_ARAID_CHALLENGE_HEADER)
    rawChallenge: string | string[] | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authorization = await this.service.beginAraIdChallenge(
      this.token(rawChallenge),
      this.araIdSessionCookie.readTeacherAccessAuthorization(request.headers.cookie) ?? undefined,
    );
    this.araIdSessionCookie.setTeacherAccessAuthorization(
      response,
      authorization.authorizationToken,
      Math.max(1, Math.ceil((authorization.expiresAt.getTime() - Date.now()) / 1000)),
    );
    return {
      success: true,
      data: { expiresAt: authorization.expiresAt.toISOString() },
    };
  }

  @Post('araid/challenge/approve')
  @ThrottleTeacherAccess()
  async approveAraIdChallenge(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const session = this.araIdSessionCookie.readSessionIdentity(request.headers.cookie);
    if (!session) throw new UnauthorizedException('กรุณาเข้าสู่ระบบ AraID');
    const authorizationToken = this.araIdSessionCookie.readTeacherAccessAuthorization(
      request.headers.cookie,
    );
    if (!authorizationToken) throw new UnauthorizedException('การยืนยัน AraID หมดอายุแล้ว');
    const result = await this.service.approveAraIdChallenge(
      authorizationToken,
      session.profileId,
      session.authenticatedAt,
    );
    this.araIdSessionCookie.clearTeacherAccessAuthorization(response);
    return result;
  }

  @Post('araid/challenge/status')
  @ThrottleTeacherAccess()
  pollAraIdChallenge(
    @Headers(TEACHER_ACCESS_ARAID_CHALLENGE_HEADER)
    rawChallenge: string | string[] | undefined,
  ) {
    return this.service.pollAraIdChallenge(this.token(rawChallenge));
  }

  @Get('context')
  @ThrottleTeacherAccess()
  context(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken?: string | string[],
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession?: string | string[],
  ) {
    return this.service.getPublicContext(this.token(rawToken), this.session(rawSession));
  }

  @Get('my-photo')
  @ThrottleTeacherAccess()
  async myPhoto(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.service.resolvePublicTeacherPhoto(
      this.token(rawToken),
      this.session(rawSession),
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    res.sendFile(result.filePath);
  }

  @Get('attendance-delegation-options')
  @ThrottleTeacherAccess()
  attendanceDelegationOptions(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Query() query: PublicTeacherAccessAttendanceDelegationOptionsDto,
    @Req() request: Request,
  ) {
    return this.service.listPublicAttendanceDelegationOptions(
      this.token(rawToken),
      query,
      this.session(rawSession),
      resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl),
    );
  }

  @Post('attendance-delegations')
  @ThrottleTeacherAccess()
  issueAttendanceDelegation(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Body() body: IssuePublicTeacherAccessAttendanceDelegationDto,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.issuePublicAttendanceDelegation(
      this.token(rawToken),
      body,
      baseUrl,
      this.session(rawSession),
    );
  }

  @Patch('attendance-delegations/:grantId')
  @ThrottleTeacherAccess()
  updateAttendanceDelegation(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() body: UpdatePublicTeacherAccessAttendanceDelegationDto,
    @Req() request: Request,
  ) {
    const baseUrl = resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl);
    return this.service.updatePublicAttendanceDelegation(
      this.token(rawToken),
      grantId,
      body,
      this.session(rawSession),
      baseUrl,
    );
  }

  @Post('attendance-delegations/:grantId/revoke')
  @ThrottleTeacherAccess()
  revokeAttendanceDelegation(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() body: RevokePublicTeacherAccessAttendanceDelegationDto,
  ) {
    return this.service.revokePublicAttendanceDelegation(
      this.token(rawToken),
      grantId,
      body.assignmentId,
      this.session(rawSession),
    );
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

  @Get('attendance-delegation-history')
  @ThrottleTeacherAccess()
  publicAttendanceDelegationHistory(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Query() query: ListPublicTeacherAccessDelegationHistoryDto,
    @Req() request: Request,
  ) {
    return this.service.listPublicAttendanceDelegationHistory(
      this.token(rawToken),
      query,
      this.session(rawSession),
      resolveExternalBaseUrl(request, this.runtimeConfig.frontendBaseUrl),
    );
  }

  @Get('attendance-imports')
  @ThrottleTeacherAccess()
  publicAttendanceImports(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Query() query: ListPublicTeacherAccessImportsDto,
  ) {
    return this.service.listPublicAttendanceImports(
      this.token(rawToken),
      query,
      this.session(rawSession),
    );
  }

  @Post('attendance-imports')
  @ThrottleTeacherAccess()
  @UseInterceptors(FileInterceptor('file', attendanceImportMulterOptions))
  recordPublicAttendanceImport(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: RecordPublicTeacherAccessImportDto,
  ) {
    return this.service.recordPublicAttendanceImport(
      this.token(rawToken),
      { ...body, file },
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

  @Get('student-photo')
  @ThrottleTeacherAccess()
  async studentPhoto(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Query() query: TeacherAccessStudentProfileQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.service.resolvePublicStudentPhoto(
      this.token(rawToken),
      query,
      this.session(rawSession),
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    res.sendFile(result.filePath);
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

  @Get('attendance-session')
  @ThrottleTeacherAccess()
  attendanceSession(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Query() query: TeacherAccessAttendanceSessionQueryDto,
  ) {
    return this.service.getPublicAttendanceSession(
      this.token(rawToken),
      query,
      this.session(rawSession),
    );
  }

  @Post('attendance-marks')
  @ThrottleTeacherAccess()
  attendanceMarks(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @Body() body: SaveTeacherAccessAttendanceMarksDto,
  ) {
    return this.service.savePublicAttendanceMarks(
      this.token(rawToken),
      body,
      this.session(rawSession),
    );
  }

  @Post('attendance-import/parse')
  @ThrottleTeacherAccess()
  @UseInterceptors(FileInterceptor('file', attendanceImportMulterOptions))
  attendanceImportParse(
    @Headers(TEACHER_ACCESS_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Headers(TEACHER_ACCESS_SESSION_HEADER) rawSession: string | string[] | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: ParsePublicAttendanceImportDto,
  ) {
    return this.service.parsePublicAttendanceImport(
      this.token(rawToken),
      body,
      file,
      this.session(rawSession),
    );
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
