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
import { AuthGuard, CurrentUser, PermissionsGuard, RequirePermission } from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import {
  CreateTimetableSlotDto,
  ListTimetableSlotsQueryDto,
  RoomSubjectsQueryDto,
  UpdateTimetableSlotDto,
} from './dto/timetable.dto';
import { TimetableService } from './timetable.service';

@UseGuards(AuthGuard)
@Controller('api/timetable')
export class TimetableController {
  constructor(private readonly timetableService: TimetableService) {}

  // Any authenticated user reads their own schedule — the service resolves
  // student/teacher/staff visibility internally (see getMySchedule).
  @Get('my-schedule')
  async mySchedule(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Query('schoolId') schoolId?: string,
    @Query('gradeLevelId') gradeLevelId?: string,
    @Query('roomNo') roomNo?: string,
    @Query('mine') mine?: string,
  ) {
    return await this.timetableService.getMySchedule(actor, {
      schoolId: schoolId !== undefined ? Number(schoolId) : undefined,
      gradeLevelId: gradeLevelId !== undefined ? Number(gradeLevelId) : undefined,
      roomNo: roomNo !== undefined ? Number(roomNo) : undefined,
      mine: mine === 'true',
    });
  }

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

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-timetable')
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
  @RequirePermission('manage-timetable')
  @Post('slots')
  async create(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() body: CreateTimetableSlotDto,
  ) {
    return await this.timetableService.create(actor, body);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-timetable')
  @Patch('slots/:id')
  async update(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('id') id: string,
    @Body() body: UpdateTimetableSlotDto,
  ) {
    return await this.timetableService.update(actor, id, body);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-timetable')
  @Delete('slots/:id')
  async remove(@CurrentUser() actor: AuthenticatedRequestUser, @Param('id') id: string) {
    return await this.timetableService.remove(actor, id);
  }
}
