import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
  CreateClassroomTeacherAssignmentDto,
  CreateSchoolClassroomDto,
  CreateSchoolTeacherMembershipDto,
  ListClassroomAssignmentsDto,
  ListClassroomRosterDto,
  ListSchoolClassroomOptionsDto,
  ListSchoolClassroomsDto,
  ListSchoolTeacherCandidatesDto,
  ListSchoolTeachersDto,
  UpdateSchoolClassroomDto,
  UpdateSchoolTeacherMembershipDto,
} from './dto/school-structure.dto';
import { SchoolStructureService } from './school-structure.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('manage-school-structure')
@Controller('api/school-structure')
export class SchoolStructureController {
  constructor(private readonly service: SchoolStructureService) {}

  @Get('schools')
  @RequirePermission()
  @RequireAnyPermission(
    'manage-school-structure',
    'manage-teacher-access',
    'import-data',
    'import-school-roster',
  )
  listSchools(@CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.listSchools(actor);
  }

  @Get('classrooms')
  @RequirePermission()
  @RequireAnyPermission(
    'manage-school-structure',
    'manage-teacher-access',
    'import-data',
    'import-school-roster',
  )
  listClassrooms(
    @Query() query: ListSchoolClassroomsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listClassrooms(query, actor);
  }

  @Get('classrooms/options')
  @RequirePermission()
  @RequireAnyPermission(
    'manage-school-structure',
    'manage-teacher-access',
    'import-data',
    'import-school-roster',
  )
  listClassroomOptions(
    @Query() query: ListSchoolClassroomOptionsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listClassroomOptions(query, actor);
  }

  @Post('classrooms')
  createClassroom(
    @Body() body: CreateSchoolClassroomDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.createClassroom(body, actor);
  }

  @Patch('classrooms/:classroomId')
  updateClassroom(
    @Param('classroomId', ParseIntPipe) classroomId: number,
    @Body() body: UpdateSchoolClassroomDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.updateClassroom(classroomId, body, actor);
  }

  @Delete('classrooms/:classroomId')
  deleteClassroom(
    @Param('classroomId', ParseIntPipe) classroomId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.deleteClassroom(classroomId, actor);
  }

  @Get('teachers')
  @RequirePermission()
  @RequireAnyPermission('manage-school-structure', 'manage-teacher-access')
  listTeachers(
    @Query() query: ListSchoolTeachersDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listTeachers(query, actor);
  }

  @Get('teachers/options')
  @RequirePermission()
  @RequireAnyPermission('manage-school-structure', 'manage-teacher-access')
  listTeacherOptions(
    @Query() query: ListSchoolTeacherCandidatesDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listTeacherOptions(query, actor);
  }

  @Get('teacher-candidates')
  listTeacherCandidates(
    @Query() query: ListSchoolTeacherCandidatesDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listTeacherCandidates(query, actor);
  }

  @Post('teachers')
  createTeacherMembership(
    @Body() body: CreateSchoolTeacherMembershipDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.createTeacherMembership(body, actor);
  }

  @Patch('teachers/:membershipId')
  updateTeacherMembership(
    @Param('membershipId', ParseIntPipe) membershipId: number,
    @Body() body: UpdateSchoolTeacherMembershipDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.updateTeacherMembership(membershipId, body, actor);
  }

  @Get('assignments')
  listAssignments(
    @Query() query: ListClassroomAssignmentsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listAssignments(query.classroomId, actor);
  }

  @Post('assignments')
  createAssignment(
    @Body() body: CreateClassroomTeacherAssignmentDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.createAssignment(body, actor);
  }

  @Get('roster')
  listRoster(
    @Query() query: ListClassroomRosterDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listRoster(query, actor);
  }
}
