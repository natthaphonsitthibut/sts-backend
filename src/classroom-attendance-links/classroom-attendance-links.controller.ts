import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
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
  UploadedFile,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { multerConfig } from '../common/interceptors/file-upload.interceptor';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  Public,
  RequireAnyPermission,
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
  ClassroomLinkRosterQueryDto,
  ClassroomLinkSessionQueryDto,
  ClassroomLinkStudentPhotoQueryDto,
  ListMyAssignmentLinksDto,
  SubmitClassroomLinkAttendanceDto,
  CreateLinkAttendanceAssignmentDto,
  CreateAttendanceAssignmentDto,
  ClassroomLineGroupInvitationDto,
  GoogleCallbackDto,
  ListClassroomAttendanceLinksDto,
  ListIssuedClassroomLinksDto,
  ListClassroomLinkAttendanceHistoryDto,
  UpdateLinkClassroomPresentationDto,
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
import { SchoolStructureService } from '../school-structure/school-structure.service';
import { ExceptionAttendanceService } from '../attendance/exception-attendance.service';
import {
  CheckInOptionsQueryDto,
  StartExceptionAttendanceDto,
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

  // The มอบหมาย button lives on the check-in page, so the check-in permission
  // is what has to reach this — otherwise the button is offered to someone the
  // endpoint will refuse. Scope is unchanged: the room still has to be theirs.
  @Post('assignments')
  @RequirePermission()
  @RequireAnyPermission('manage-classroom-links', 'attendance')
  async createAssignment(
    @Body() body: CreateAttendanceAssignmentDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    return await this.service.createAssignment(
      body,
      actor,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
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

  /**
   * The assignments this account issued, for the tab inside check-in.
   *
   * Reachable with the check-in page's own permission, not only the
   * link-management one: the มอบหมาย button lives on that page, and a screen
   * that lets someone create a link and then refuses to show it back is the
   * kind of half-permission the owner ruled out. Ownership still gates every
   * row — this is "what I handed on", never the school's register.
   */
  @Get('assignments/mine')
  @RequirePermission()
  @RequireAnyPermission('manage-classroom-links', 'attendance')
  listMyAssignments(
    @Query() query: ListMyAssignmentLinksDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listMyAssignments({ kind: 'USER', actor }, query);
  }

  @Get('assignments/mine/:id/usage')
  @RequirePermission()
  @RequireAnyPermission('manage-classroom-links', 'attendance')
  myAssignmentUsage(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.myAssignmentUsage({ kind: 'USER', actor }, id);
  }

  @Get('assignments/mine/:id/link')
  @RequirePermission()
  @RequireAnyPermission('manage-classroom-links', 'attendance')
  myAssignmentLink(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    return this.service.myAssignmentAccessUrl(
      { kind: 'USER', actor },
      id,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
  }

  @Post('assignments/mine/:id/rotate')
  @RequirePermission()
  @RequireAnyPermission('manage-classroom-links', 'attendance')
  rotateMyAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Req() request: Request,
  ) {
    return this.service.rotateMyAssignment(
      { kind: 'USER', actor },
      id,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
  }

  @Post('assignments/mine/:id/deactivate')
  @RequirePermission()
  @RequireAnyPermission('manage-classroom-links', 'attendance')
  deactivateMyAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.deactivateMyAssignment({ kind: 'USER', actor }, id);
  }

  /** Every link this school has issued this term, teacher links and assignments alike. */
  @Get('issued')
  listIssued(
    @Query() query: ListIssuedClassroomLinksDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listIssued(query, actor);
  }

  /** Who opened one link, and every register taken through it. */
  @Get(':id/usage')
  usage(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.usage(id, actor);
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
    private readonly schoolStructure: SchoolStructureService,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  /**
   * The acting teacher, and the room they are acting in.
   *
   * A teacher link is not tied to one classroom, so the room has to be named —
   * except when the teacher has exactly one, where asking would be ceremony.
   * Whatever is named is checked against the subjects they actually teach.
   */
  private async attendanceActor(request: Request, classroomId?: number) {
    const authorized = await this.service.authorizeCheckInSession(
      this.cookies.read(request.headers.cookie),
    );
    let resolvedClassroomId = classroomId;
    if (resolvedClassroomId === undefined) {
      const classrooms = await this.service.listAuthorizedClassrooms(authorized);
      if (classrooms.length !== 1) {
        throw new BadRequestException('กรุณาเลือกห้องเรียนที่ต้องการเช็กชื่อ');
      }
      resolvedClassroomId = Number(classrooms[0].classroom_id);
    } else {
      await this.service.assertAuthorizedClassroom(authorized, resolvedClassroomId);
    }
    return {
      source: 'CLASSROOM_LINK' as const,
      schoolId: authorized.schoolId,
      classroomId: resolvedClassroomId,
      actorUserId: null,
      teacherMembershipId: authorized.teacherMembershipId,
      actorLabel: authorized.teacherDisplayName,
      studentDataAccess:
        authorized.assignedClassroomSubjectId === null
          ? ('FULL' as const)
          : ('ATTENDANCE_ONLY' as const),
      // Stamped on the session so the link's register can say what came of it.
      classroomAttendanceLinkId: authorized.linkId,
      allowedClassroomSubjectIds: await this.service.listAuthorizedSubjectIds(
        authorized,
        resolvedClassroomId,
      ),
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
      await this.attendanceActor(request, query.classroomId),
      query.date,
    );
  }

  @Get('roster')
  @ThrottleTeacherAccess()
  async roster(
    @Query() query: ClassroomLinkRosterQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return await this.exceptionAttendance.getRoster(
      await this.attendanceActor(request, query.classroomId),
      { date: query.date, classroomSubjectId: query.classroomSubjectId },
    );
  }

  @Get('student-photo')
  @ThrottleTeacherAccess()
  async studentPhoto(
    @Query() query: ClassroomLinkStudentPhotoQueryDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.noStore(response);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const result = await this.exceptionAttendance.resolveStudentPhoto(
      // The room travels with the request, as it does for the roster: a
      // standing link reaches every room its teacher's subjects touch, and
      // without one named there is nothing to infer. The id is checked against
      // the session before the photo is resolved.
      await this.attendanceActor(request, query.classroomId),
      query.studentId,
    );
    if (result.kind === 'redirect') {
      response.redirect(302, result.url);
      return;
    }
    response.sendFile(result.filePath);
  }

  /**
   * The signed-in link teacher's own photo, served the way every other photo in
   * the app is: through the API so the session check runs before the bytes, and
   * never cached, because the adapter hands back a short-lived signed URL.
   */
  @Get('my-photo')
  @ThrottleTeacherAccess()
  async myPhoto(@Req() request: Request, @Res() response: Response): Promise<void> {
    this.noStore(response);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const result = await this.service.resolveTeacherPhoto(
      this.cookies.read(request.headers.cookie),
    );
    if (result.kind === 'redirect') {
      response.redirect(302, result.url);
      return;
    }
    response.sendFile(result.filePath);
  }

  @Post('assignments')
  @ThrottleTeacherAccess()
  async createAssignmentFromLink(
    @Body() body: CreateLinkAttendanceAssignmentDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const authorized = await this.service.authorizeCheckInSession(
      this.cookies.read(request.headers.cookie),
    );
    return await this.service.createAssignmentFromLink(
      authorized,
      body,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
  }

  /**
   * The assignments this teacher issued from their own link.
   *
   * Same rows the admin screen sees through its own door, gated on the
   * membership on the session rather than on an account. Someone covering an
   * assignment gets nothing here: their session issued nothing, so the list is
   * empty by the same rule that hides the มอบหมาย button from them — no extra
   * branch to keep in step.
   */
  @Get('assignments/mine')
  @ThrottleTeacherAccess()
  async listMyLinkAssignments(
    @Query() query: ListMyAssignmentLinksDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const authorized = await this.service.authorizeCheckInSession(
      this.cookies.read(request.headers.cookie),
    );
    return await this.service.listMyAssignments({ kind: 'LINK', authorized }, query);
  }

  @Get('assignments/mine/:id/usage')
  @ThrottleTeacherAccess()
  async myLinkAssignmentUsage(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const authorized = await this.service.authorizeCheckInSession(
      this.cookies.read(request.headers.cookie),
    );
    return await this.service.myAssignmentUsage({ kind: 'LINK', authorized }, id);
  }

  @Get('assignments/mine/:id/link')
  @ThrottleTeacherAccess()
  async myLinkAssignmentAccessUrl(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const authorized = await this.service.authorizeCheckInSession(
      this.cookies.read(request.headers.cookie),
    );
    return await this.service.myAssignmentAccessUrl(
      { kind: 'LINK', authorized },
      id,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
  }

  @Post('assignments/mine/:id/rotate')
  @ThrottleTeacherAccess()
  async rotateMyLinkAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const authorized = await this.service.authorizeCheckInSession(
      this.cookies.read(request.headers.cookie),
    );
    return await this.service.rotateMyAssignment(
      { kind: 'LINK', authorized },
      id,
      resolveExternalBaseUrl(request, this.app.frontendBaseUrl),
    );
  }

  @Post('assignments/mine/:id/deactivate')
  @ThrottleTeacherAccess()
  async deactivateMyLinkAssignment(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const authorized = await this.service.authorizeCheckInSession(
      this.cookies.read(request.headers.cookie),
    );
    return await this.service.deactivateMyAssignment({ kind: 'LINK', authorized }, id);
  }

  /**
   * The room's attendance history, as the app shows it.
   *
   * A teacher who holds a standing link owns these rooms all term, so the past
   * is theirs to read — it is how they notice the child who has been absent
   * three Mondays running. An assignment covers one lesson on set days and is
   * refused here: whoever picked it up was asked to take a register, not handed
   * a term of someone else's room.
   */
  @Get('attendance-history')
  @ThrottleTeacherAccess()
  async attendanceHistory(
    @Query() query: ListClassroomLinkAttendanceHistoryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const authorized = await this.service.authorizeCheckInSession(
      this.cookies.read(request.headers.cookie),
    );
    if (authorized.assignedClassroomSubjectId !== null) {
      throw new ForbiddenException('ลิงก์มอบหมายดูประวัติการเช็กชื่อไม่ได้');
    }
    await this.service.assertAuthorizedClassroom(authorized, query.classroomId);
    return await this.schoolStructure.readClassroomAttendanceHistory(
      query.classroomId,
      query,
      (studentUuid, version) =>
        `/${CLASSROOM_LINK_API_PATH}/student-photo?studentId=${encodeURIComponent(studentUuid)}&v=${version}`,
    );
  }

  /**
   * The room's cover, and the teacher's right to change it.
   *
   * A classroom card is the room's own — the colour and the photo are the same
   * record ห้องเรียนทั้งหมด writes. A teacher who teaches here should not have
   * to ask the office to change the picture of a room they stand in every day,
   * so the link writes that same record rather than keeping a second one that
   * would drift.
   */
  @Get('classroom-cover')
  @ThrottleTeacherAccess()
  async classroomCover(
    @Query() query: ClassroomLinkRosterQueryDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    this.noStore(response);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const authorized = await this.service.authorizeCheckInSession(
      this.cookies.read(request.headers.cookie),
    );
    const classroomId = await this.service.assertAuthorizedClassroom(
      authorized,
      Number(query.classroomId),
    );
    const result = await this.schoolStructure.readClassroomCover(classroomId);
    if (result.kind === 'redirect') {
      response.redirect(302, result.url);
      return;
    }
    response.sendFile(result.filePath);
  }

  @Patch('classroom-presentation')
  @ThrottleTeacherAccess()
  @UseInterceptors(FileInterceptor('photo', multerConfig))
  async updateClassroomPresentation(
    @Body() body: UpdateLinkClassroomPresentationDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const authorized = await this.service.authorizeCheckInSession(
      this.cookies.read(request.headers.cookie),
    );
    const classroomId = await this.service.assertAuthorizedClassroom(authorized, body.classroomId);
    return await this.schoolStructure.applyClassroomPresentation(classroomId, body, {
      actorUserId: null,
      actorLabel: authorized.teacherDisplayName,
      file,
    });
  }

  @Get('sessions/current')
  @ThrottleTeacherAccess()
  async currentSession(
    @Query() query: ClassroomLinkSessionQueryDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return await this.exceptionAttendance.findLessonSession(
      await this.attendanceActor(request, query.classroomId),
      { date: query.date, classroomSubjectId: query.classroomSubjectId },
    );
  }

  @Post('sessions/start')
  @ThrottleTeacherAccess()
  async startSession(
    @Body() body: StartExceptionAttendanceDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return await this.exceptionAttendance.start(
      await this.attendanceActor(request, body.classroomId),
      body,
    );
  }

  @Post('sessions/:sessionId/submit')
  @ThrottleTeacherAccess()
  async submitSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: SubmitClassroomLinkAttendanceDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return await this.exceptionAttendance.submit(
      await this.attendanceActor(request, body.classroomId),
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
    const redirect = new URL(
      CLASSROOM_LINK_PATH,
      this.app.frontendBaseUrl || 'http://localhost:5173',
    );
    // Declining consent is a user's choice, not an error to investigate: Google
    // sends `error` back with no code, and the teacher belongs on the link page
    // with the sign-in choices again — not on a JSON error body.
    if (query.error || !query.code || !query.state) {
      redirect.searchParams.set('auth', 'failed');
      response.redirect(302, redirect.toString());
      return;
    }
    const session = await this.service.googleCallback(query.code, query.state);
    this.cookies.set(response, session);
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
