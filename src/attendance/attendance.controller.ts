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
  UseGuards,
} from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  normalizeDataScope,
  type AuthenticatedRequestUser,
} from '../auth';
import { AttendanceService } from './attendance.service';
import {
  GetAttendanceTasksQueryDto,
  GetHistoryQueryDto,
  GetRoomsQueryDto,
  GetSchoolsQueryDto,
  GetStudentsQueryDto,
  SaveAttendanceDto,
} from './dto/attendance.dto';
import { resolveLimit, resolvePage } from '../common/pagination/pagination.util';
import { AttendanceOperationsService } from './attendance-operations.service';
import {
  AttendanceReconciliationQueryDto,
  AttendanceReconciliationAnomaliesQueryDto,
  AttendanceSessionContextQueryDto,
  GenerateSchoolCalendarDto,
  ListSchoolCalendarQueryDto,
  ListSchoolTermsQueryDto,
  ReopenAttendanceSessionDto,
  UpdateSchoolCalendarDayDto,
  UpsertSchoolTermDto,
} from './dto/attendance-operations.dto';

@UseGuards(AuthGuard)
@Controller('api/attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly attendanceOperationsService: AttendanceOperationsService,
  ) {}

  @Get('grade-levels')
  async getGradeLevels() {
    return await this.attendanceService.getGradeLevels();
  }

  @Get('schools')
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
      normalizeDataScope(actor?.data_scope),
    );
  }

  @Get('locations')
  async getLocations() {
    return await this.attendanceService.getLocations();
  }

  @Get('students')
  async getStudents(
    @Query() query: GetStudentsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceService.getStudents(
      query.grade,
      query.room,
      query.schoolId,
      normalizeDataScope(actor?.data_scope),
    );
  }

  @Get('history')
  async getHistory(
    @Query() query: GetHistoryQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    const schoolId = query.schoolId ? Number(query.schoolId) : null;
    return await this.attendanceService.getHistory(
      query.date,
      normalizeDataScope(actor?.data_scope),
      Number.isInteger(schoolId) ? schoolId : null,
    );
  }

  // Class-level AuthGuard authenticates; PermissionsGuard here additionally
  // requires the 'attendance' permission so only teachers/admins (not e.g.
  // executives or students) can write attendance. Actor is passed so the write
  // is scope-checked and attributed to the real user, not a hardcoded "Admin".
  @Post()
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async saveAttendance(
    @Body() body: SaveAttendanceDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceService.saveAttendance(body.records, actor);
  }

  @Get('tasks')
  async getAttendanceTasks(
    @Query() query: GetAttendanceTasksQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    const scope = normalizeDataScope(actor?.data_scope);
    // Opt-in pagination: the dashboard sends `page` and gets the paginated
    // envelope; legacy callers (no page) still get the full array.
    if (query.page === undefined) {
      return await this.attendanceService.getAttendanceTasks(scope);
    }
    return await this.attendanceService.getAttendanceTasksPaginated(scope, {
      page: resolvePage(query.page),
      limit: resolveLimit(query.limit),
      searchTerm: query.searchTerm?.trim() || undefined,
      status: query.status,
      province: query.province?.trim() || undefined,
      district: query.district?.trim() || undefined,
      subDistrict: query.subDistrict?.trim() || undefined,
      schoolId: query.schoolId,
      grade: query.grade?.trim() || undefined,
      room: query.room?.trim() || undefined,
    });
  }

  @Get('rooms')
  async getRooms(@Query() query: GetRoomsQueryDto) {
    return await this.attendanceService.getRooms(query.grade, query.schoolId);
  }

  @Get('terms')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission('attendance-dashboard', 'settings')
  async listTerms(
    @Query() query: ListSchoolTermsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.listTerms(query.schoolId, actor);
  }

  @Post('terms')
  @UseGuards(PermissionsGuard)
  @RequirePermission('settings')
  async upsertTerm(
    @Body() body: UpsertSchoolTermDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.upsertTerm(body, actor);
  }

  @Post('terms/:termId/calendar/generate')
  @UseGuards(PermissionsGuard)
  @RequirePermission('settings')
  async generateCalendar(
    @Param('termId', ParseIntPipe) termId: number,
    @Body() body: GenerateSchoolCalendarDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.generateCalendar(termId, body.schoolDays, actor);
  }

  @Get('calendar')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission('attendance-dashboard', 'settings')
  async listCalendar(
    @Query() query: ListSchoolCalendarQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.listCalendar(query.termId, actor);
  }

  @Patch('calendar-days/:calendarDayId')
  @UseGuards(PermissionsGuard)
  @RequirePermission('settings')
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

  @Get('session')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async getSessionContext(
    @Query() query: AttendanceSessionContextQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.getSessionContext(
      query.schoolId,
      query.grade,
      query.room,
      query.date,
      actor,
    );
  }

  @Post('sessions/:sessionId/reopen')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async reopenSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: ReopenAttendanceSessionDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.reopenSession(sessionId, body.reason, actor);
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
    );
  }
}
