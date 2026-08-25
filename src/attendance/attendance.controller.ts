import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  resolveActorDataScope,
  type AuthenticatedRequestUser,
} from '../auth';
import type { Response } from 'express';
import { AttendanceService } from './attendance.service';
import {
  GetHistoryQueryDto,
  GetRoomsQueryDto,
  GetSchoolsQueryDto,
  GetStudentsQueryDto,
} from './dto/attendance.dto';
import { resolveLimit, resolvePage } from '../common/pagination/pagination.util';
import { AttendanceOperationsService } from './attendance-operations.service';
import {
  AttendanceReconciliationQueryDto,
  AttendanceReconciliationAnomaliesQueryDto,
  GenerateSchoolCalendarDto,
  ListSchoolCalendarQueryDto,
  ListSchoolTermsQueryDto,
  UpdateSchoolCalendarDayDto,
  UpsertSchoolTermDto,
} from './dto/attendance-operations.dto';
import {
  InternalCheckInOptionsQueryDto,
  InternalCheckInRosterQueryDto,
  StartInternalExceptionAttendanceDto,
  SubmitExceptionAttendanceDto,
} from './dto/exception-attendance.dto';
import { ExceptionAttendanceService } from './exception-attendance.service';

@UseGuards(AuthGuard)
@Controller('api/attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly attendanceOperationsService: AttendanceOperationsService,
    private readonly exceptionAttendanceService: ExceptionAttendanceService,
  ) {}

  @Get('check-in/options')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async checkInOptions(
    @Query() query: InternalCheckInOptionsQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    const checkInActor = await this.exceptionAttendanceService.resolveInternalActor(
      query.classroomId,
      actor,
    );
    return await this.exceptionAttendanceService.getOptions(checkInActor, query.date);
  }

  @Get('check-in/roster')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async checkInRoster(
    @Query() query: InternalCheckInRosterQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    const checkInActor = await this.exceptionAttendanceService.resolveInternalActor(
      query.classroomId,
      actor,
    );
    return await this.exceptionAttendanceService.getRoster(checkInActor);
  }

  @Get('check-in/student-photo')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async checkInStudentPhoto(
    @Query('classroomId', ParseIntPipe) classroomId: number,
    @Query('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Res() response: Response,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const checkInActor = await this.exceptionAttendanceService.resolveInternalActor(
      classroomId,
      actor,
    );
    const result = await this.exceptionAttendanceService.resolveStudentPhoto(
      checkInActor,
      studentId,
    );
    if (result.kind === 'redirect') {
      response.redirect(302, result.url);
      return;
    }
    response.sendFile(result.filePath);
  }

  @Post('check-in/sessions/start')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async startCheckInSession(
    @Body() body: StartInternalExceptionAttendanceDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    const checkInActor = await this.exceptionAttendanceService.resolveInternalActor(
      body.classroomId,
      actor,
    );
    return await this.exceptionAttendanceService.start(checkInActor, body);
  }

  @Post('check-in/sessions/:sessionId/submit')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async submitCheckInSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: SubmitExceptionAttendanceDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    const checkInActor = await this.exceptionAttendanceService.getInternalActorForSession(
      sessionId,
      actor,
    );
    return await this.exceptionAttendanceService.submit(checkInActor, sessionId, body);
  }

  @Get('grade-levels')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission(
    'attendance',
    'attendance-dashboard',
    'students',
    'manage-school-structure',
    'manage-classroom-links',
    'export-data',
  )
  async getGradeLevels() {
    return await this.attendanceService.getGradeLevels();
  }

  @Get('schools')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission(
    'attendance',
    'attendance-dashboard',
    'students',
    'manage-school-structure',
    'import-data',
    'export-data',
  )
  async getSchools(
    @Query() query: GetSchoolsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceService.getSchools(
      query.province,
      query.district,
      query.subDistrict,
      query.searchTerm,
      query.limit,
      resolveActorDataScope(actor),
    );
  }

  @Get('students')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async getStudents(
    @Query() query: GetStudentsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceService.getStudents(
      query.grade,
      query.room,
      query.schoolId,
      resolveActorDataScope(actor),
    );
  }

  @Get('history')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async getHistory(
    @Query() query: GetHistoryQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    const schoolId = query.schoolId ? Number(query.schoolId) : null;
    return await this.attendanceService.getHistory(
      query.date,
      resolveActorDataScope(actor),
      Number.isInteger(schoolId) ? schoolId : null,
      query.sessionKind,
    );
  }

  @Get('rooms')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission('attendance', 'attendance-dashboard', 'students', 'export-data')
  async getRooms(
    @Query() query: GetRoomsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceService.getRooms(
      query.grade,
      query.schoolId,
      resolveActorDataScope(actor),
    );
  }

  @Get('terms')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission(
    'attendance-dashboard',
    'attendance',
    'manage-school-structure',
    'manage-classroom-links',
    'manage-subjects',
    'import-data',
  )
  async listTerms(
    @Query() query: ListSchoolTermsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.listTerms(query.schoolId, actor);
  }

  @Post('terms')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission('attendance-dashboard', 'manage-school-structure')
  async upsertTerm(
    @Body() body: UpsertSchoolTermDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.upsertTerm(body, actor);
  }

  @Post('terms/:termId/calendar/generate')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance-dashboard')
  async generateCalendar(
    @Param('termId', ParseIntPipe) termId: number,
    @Body() body: GenerateSchoolCalendarDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.generateCalendar(termId, body.schoolDays, actor);
  }

  @Get('calendar')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission('attendance-dashboard')
  async listCalendar(
    @Query() query: ListSchoolCalendarQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.listCalendar(query.termId, actor);
  }

  @Patch('calendar-days/:calendarDayId')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance-dashboard')
  async updateCalendarDay(
    @Param('calendarDayId', ParseIntPipe) calendarDayId: number,
    @Body() body: UpdateSchoolCalendarDayDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.updateCalendarDay(
      calendarDayId,
      body.dayType,
      body.reason,
      actor,
    );
  }

  @Get('reconciliation')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance-dashboard')
  async getReconciliation(
    @Query() query: AttendanceReconciliationQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.getReconciliation(
      query.termId,
      query.date,
      resolvePage(query.page),
      resolveLimit(query.limit),
      actor,
      query.gradeLevelId,
      query.room,
    );
  }

  @Get('reconciliation/anomalies')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance-dashboard')
  async getReconciliationAnomalies(
    @Query() query: AttendanceReconciliationAnomaliesQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.getReconciliationAnomalies(
      query.termId,
      resolvePage(query.page),
      resolveLimit(query.limit),
      actor,
      query.gradeLevelId,
      query.room,
    );
  }
}
