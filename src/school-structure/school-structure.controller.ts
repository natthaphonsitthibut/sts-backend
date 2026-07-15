import {
  Body,
  Controller,
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
  ListClassroomRosterDto,
  ListSchoolClassroomsDto,
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
    return this.service.listClassrooms(query.schoolId, query.termId, actor);
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

  @Get('teachers')
  @RequirePermission()
  @RequireAnyPermission('manage-school-structure', 'manage-teacher-access')
  listTeachers(
    @Query() query: ListSchoolTeachersDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listTeachers(query.schoolId, actor);
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
    @Query() query: ListClassroomRosterDto,
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
    return this.service.listRoster(query.classroomId, actor);
  }
}
