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
  GetHistoryQueryDto,
  GetRoomsQueryDto,
  GetSchoolsQueryDto,
  GetStudentsQueryDto,
  SaveAttendanceDto,
} from './dto/attendance.dto';

@UseGuards(AuthGuard)
@Controller('api/attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Get('grade-levels')
  async getGradeLevels() {
    return await this.attendanceService.getGradeLevels();
  }

  @Get('schools')
  async getSchools(@Query() query: GetSchoolsQueryDto) {
    return await this.attendanceService.getSchools(
      query.province,
      query.district,
      query.subDistrict,
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
    return await this.attendanceService.getHistory(
      query.date,
      normalizeDataScope(actor?.data_scope),
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
  async getAttendanceTasks(@CurrentUser() actor?: AuthenticatedRequestUser) {
    return await this.attendanceService.getAttendanceTasks(normalizeDataScope(actor?.data_scope));
  }

  @Get('rooms')
  async getRooms(@Query() query: GetRoomsQueryDto) {
    return await this.attendanceService.getRooms(query.grade, query.schoolId);
  }
}
