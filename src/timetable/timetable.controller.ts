import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
} from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import {
  CreateTimetableSlotDto,
  GeneratePeriodTimesDto,
  ListPeriodTimesQueryDto,
  ListTimetableSlotsQueryDto,
  OverridePeriodTimeDto,
  RoomSubjectsQueryDto,
  TimetableTeachersQueryDto,
  UpdateTimetableSlotDto,
} from './dto/timetable.dto';
import { TimetableService } from './timetable.service';

@UseGuards(AuthGuard)
@Controller('api/timetable')
export class TimetableController {
  constructor(private readonly timetableService: TimetableService) {}

  // Combobox source for the attendance-link create form — any authenticated
  // user within their own scope, not gated behind manage-timetable.
  @Get('subjects-for-room')
  async subjectsForRoom(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Query() query: RoomSubjectsQueryDto,
  ) {
    return await this.timetableService.listSubjectsForRoom(
      actor,
      query.schoolId,
      query.gradeLevelId,
      query.roomNo,
    );
  }

  // Any authenticated user in the school's scope — the grid (visible to
  // students/teachers/staff, not just admins) reads this to label periods.
  @Get('period-times')
  async periodTimes(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Query() query: ListPeriodTimesQueryDto,
  ) {
    return await this.timetableService.listPeriodTimes(actor, query.schoolId);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('timetable')
  @Post('period-times/generate')
  async generatePeriodTimes(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() body: GeneratePeriodTimesDto,
  ) {
    return await this.timetableService.generatePeriodTimesForSchool(actor, body);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('timetable')
  @Patch('period-times/override')
  async overridePeriodTime(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() body: OverridePeriodTimeDto,
  ) {
    return await this.timetableService.overridePeriodTime(actor, body);
  }

  @UseGuards(PermissionsGuard)
  @RequireAnyPermission('timetable', 'manage-school-structure')
  @Get('teachers')
  async teachers(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Query() query: TimetableTeachersQueryDto,
  ) {
    return await this.timetableService.listTeacherCandidates(
      actor,
      query.schoolId,
      query.searchTerm?.trim() || undefined,
      query.subjectId,
      query.gradeLevelId,
      query.roomNo,
    );
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('timetable')
  @Get('slots')
  async listSlots(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Query() query: ListTimetableSlotsQueryDto,
  ) {
    return await this.timetableService.listForRoom(
      actor,
      query.schoolId,
      query.gradeLevelId,
      query.roomNo,
    );
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('timetable')
  @Post('slots')
  async create(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() body: CreateTimetableSlotDto,
  ) {
    return await this.timetableService.create(actor, body);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('timetable')
  @Patch('slots/:id')
  async update(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() body: UpdateTimetableSlotDto,
  ) {
    return await this.timetableService.update(actor, id, body);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('timetable')
  @Delete('slots/:id')
  async remove(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id') id: string) {
    return await this.timetableService.remove(actor, id);
  }
}
