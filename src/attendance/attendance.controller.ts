import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
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

@UseGuards(AuthGuard)
@Controller('api/attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

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
    });
  }

  @Get('rooms')
  async getRooms(@Query() query: GetRoomsQueryDto) {
    return await this.attendanceService.getRooms(query.grade, query.schoolId);
  }
}
