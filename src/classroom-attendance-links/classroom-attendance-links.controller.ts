import {
  Body,
  Controller,
  Get,
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
  UseGuards,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  Public,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { AraIdSessionCookieService } from '../araid/araid-session-cookie.service';
import { resolveExternalBaseUrl } from '../common/utils/request-url';
import { appConfig } from '../config/app.config';
import { ThrottleTeacherAccess } from '../config/throttle.decorators';
import { DevelopmentGoogleLoginDto } from '../google-login/dto/development-google-login.dto';
import {
  BulkCreateClassroomAttendanceLinksDto,
  ClassroomLineGroupInvitationDto,
  GoogleCallbackDto,
  ListClassroomAttendanceLinksDto,
  ResendClassroomAttendanceLinkLineDto,
} from './dto/classroom-attendance-links.dto';
import {
  CLASSROOM_LINK_API_PATH,
  CLASSROOM_LINK_LEGACY_API_PATH,
  CLASSROOM_LINK_PATH,
  CLASSROOM_LINK_TOKEN_HEADER,
} from './classroom-attendance-links.constants';
import { ClassroomAttendanceLinksService } from './classroom-attendance-links.service';
import { ClassroomLinkCookieService } from './classroom-link-cookie.service';
import { ExceptionAttendanceService } from '../attendance/exception-attendance.service';
import {
  CheckInOptionsQueryDto,
  CheckInStudentPhotoQueryDto,
  StartExceptionAttendanceDto,
  SubmitExceptionAttendanceDto,
} from '../attendance/dto/exception-attendance.dto';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('manage-classroom-links')
@Controller('api/classroom-attendance-links')
export class ClassroomAttendanceLinksAdminController {
  constructor(
    private readonly service: ClassroomAttendanceLinksService,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  @Get()
  list(
    @Query() query: ListClassroomAttendanceLinksDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.list(query, actor);
  }

  @Post('bulk')
  bulk(
    @Body() body: BulkCreateClassroomAttendanceLinksDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    return this.service.bulkCreate(
      body,
      actor,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
  }

  @Post('line-group-invitation')
  issueLineGroupInvitation(
    @Body() body: ClassroomLineGroupInvitationDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    return this.service.issueLineGroupInvitation(
      body,
      actor,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
  }

  @Get('line-group-invitation')
  getLineGroupInvitation(
    @Query('schoolId', ParseIntPipe) schoolId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    return this.service.getLineGroupInvitation(
      schoolId,
      actor,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
  }

  @Patch('line-group-invitation/:invitationId')
  updateLineGroupInvitation(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Body() body: ClassroomLineGroupInvitationDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    return this.service.updateLineGroupInvitation(
      invitationId,
      body,
      actor,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
  }

  @Post('line-group-invitation/:invitationId/revoke')
  revokeLineGroupInvitation(
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @Query('schoolId', ParseIntPipe) schoolId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.revokeLineGroupInvitation(invitationId, schoolId, actor);
  }

  @Get(':id/link')
  link(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    return this.service.redisplay(
      id,
      actor,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
  }

  @Post(':id/rotate')
  rotate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    return this.service.rotate(
      id,
      actor,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
  }

  @Post(':id/resend-line')
  resendLine(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ResendClassroomAttendanceLinkLineDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    return this.service.resendLine(
      id,
      body,
      actor,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
  }

  @Post(':id/deactivate')
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.deactivate(id, actor);
  }
}

@Public()
@Controller([CLASSROOM_LINK_API_PATH, CLASSROOM_LINK_LEGACY_API_PATH])
export class ClassroomCheckInAuthController {
  constructor(
    private readonly service: ClassroomAttendanceLinksService,
    private readonly cookies: ClassroomLinkCookieService,
    private readonly araIdCookies: AraIdSessionCookieService,
    private readonly exceptionAttendance: ExceptionAttendanceService,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  private async attendanceActor(request: Request) {
    const authorized = await this.service.authorizeCheckInSession(
      this.cookies.read(request.headers.cookie),
    );
    return {
      source: 'CLASSROOM_LINK' as const,
      schoolId: authorized.schoolId,
      classroomId: authorized.classroomId,
      actorUserId: null,
      teacherMembershipId: authorized.teacherMembershipId,
      actorLabel: authorized.teacherDisplayName,
    };
  }

  private noStore(response: Response): void {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Pragma', 'no-cache');
  }

  private header(value?: string | string[]): string | undefined {
    const resolved = Array.isArray(value) ? value[0] : value;
    return resolved?.trim() || undefined;
  }

  @Get('context')
  @ThrottleTeacherAccess()
  context(
    @Headers(CLASSROOM_LINK_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return this.service.context(this.header(rawToken), this.cookies.read(request.headers.cookie));
  }

  @Get('subjects')
  @ThrottleTeacherAccess()
  async subjects(
    @Query() query: CheckInOptionsQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return await this.exceptionAttendance.getOptions(
      await this.attendanceActor(request),
      query.date,
    );
  }

  @Get('roster')
  @ThrottleTeacherAccess()
  async roster(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    this.noStore(response);
    return await this.exceptionAttendance.getRoster(await this.attendanceActor(request));
  }

  @Get('student-photo')
  @ThrottleTeacherAccess()
  async studentPhoto(
    @Query() query: CheckInStudentPhotoQueryDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.noStore(response);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const result = await this.exceptionAttendance.resolveStudentPhoto(
      await this.attendanceActor(request),
      query.studentId,
    );
    if (result.kind === 'redirect') {
      response.redirect(302, result.url);
      return;
    }
    response.sendFile(result.filePath);
  }

  @Post('sessions/start')
  @ThrottleTeacherAccess()
  async startSession(
    @Body() body: StartExceptionAttendanceDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return await this.exceptionAttendance.start(await this.attendanceActor(request), body);
  }

  @Post('sessions/:sessionId/submit')
  @ThrottleTeacherAccess()
  async submitSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: SubmitExceptionAttendanceDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return await this.exceptionAttendance.submit(
      await this.attendanceActor(request),
      sessionId,
      body,
    );
  }

  @Get('auth/google/start')
  @ThrottleTeacherAccess()
  googleStart(
    @Headers(CLASSROOM_LINK_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const token = this.header(rawToken);
    if (!token) throw new UnauthorizedException('กรุณาเปิดจากลิงก์ห้องเรียน');
    return this.service.googleStart(token);
  }

  @Get('auth/google/callback')
  @ThrottleTeacherAccess()
  async googleCallback(
    @Query() query: GoogleCallbackDto,
    @Res() response: Response,
  ): Promise<void> {
    this.noStore(response);
    const session = await this.service.googleCallback(query.code, query.state);
    this.cookies.set(response, session);
    const redirect = new URL(
      CLASSROOM_LINK_PATH,
      this.app.frontendBaseUrl || 'http://localhost:5173',
    );
    redirect.searchParams.set('auth', 'google');
    response.redirect(302, redirect.toString());
  }

  @Post('auth/google/development')
  @ThrottleTeacherAccess()
  async googleDevelopment(
    @Headers(CLASSROOM_LINK_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Body() body: DevelopmentGoogleLoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const token = this.header(rawToken);
    if (!token) throw new UnauthorizedException('กรุณาเปิดจากลิงก์ห้องเรียน');
    const session = await this.service.googleDevelopment(token, body.email);
    this.cookies.set(response, session);
    return { success: true, data: { authenticated: true } };
  }

  @Post('auth/araid/challenge')
  @ThrottleTeacherAccess()
  createAraIdChallenge(
    @Headers(CLASSROOM_LINK_TOKEN_HEADER) rawToken: string | string[] | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const token = this.header(rawToken);
    if (!token) throw new UnauthorizedException('กรุณาเปิดจากลิงก์ห้องเรียน');
    return this.service.createAraIdChallenge(
      token,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
  }

  @Post('auth/araid/challenge/begin')
  @ThrottleTeacherAccess()
  async beginAraIdChallenge(
    @Headers('x-araid-challenge') challenge: string | string[] | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const token = this.header(challenge);
    if (!token) throw new UnauthorizedException('ไม่พบคำขอยืนยัน AraID');
    const authorization = await this.service.beginAraIdChallenge(
      token,
      this.araIdCookies.readClassroomCheckInAuthorization(request.headers.cookie) ?? undefined,
    );
    this.araIdCookies.setClassroomCheckInAuthorization(
      response,
      authorization.authorizationToken,
      Math.max(1, Math.ceil((authorization.expiresAt - Date.now()) / 1000)),
    );
    return { success: true, data: { expiresAt: new Date(authorization.expiresAt).toISOString() } };
  }

  @Post('auth/araid/challenge/approve')
  @ThrottleTeacherAccess()
  async approveAraIdChallenge(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const identity = this.araIdCookies.readSessionIdentity(request.headers.cookie);
    const authorization = this.araIdCookies.readClassroomCheckInAuthorization(
      request.headers.cookie,
    );
    if (!identity || !authorization)
      throw new UnauthorizedException('กรุณาเข้าสู่ระบบ AraID และกรอก PIN ใหม่');
    const result = await this.service.approveAraIdChallenge(
      authorization,
      identity.profileId,
      identity.authenticatedAt,
    );
    this.araIdCookies.clearClassroomCheckInAuthorization(response);
    return result;
  }

  @Post('auth/araid/challenge/status')
  @ThrottleTeacherAccess()
  async pollAraIdChallenge(
    @Headers('x-araid-challenge') challenge: string | string[] | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const token = this.header(challenge);
    if (!token) throw new UnauthorizedException('ไม่พบคำขอยืนยัน AraID');
    const result = await this.service.pollAraIdChallenge(token);
    if (result.sessionToken) this.cookies.set(response, result.sessionToken);
    return result.response;
  }
}
