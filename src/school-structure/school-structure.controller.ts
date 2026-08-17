import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
} from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import {
  AuthorizeClassroomExportDto,
  CreateClassroomTeacherAssignmentDto,
  CreateClassroomStudentCommentDto,
  CreateSchoolClassroomDto,
  CreateSchoolTeacherMembershipDto,
  ListClassroomAssignmentsDto,
  ListClassroomRosterDto,
  ListClassroomAttendanceHistoryDto,
  ListSchoolClassroomOptionsDto,
  ListSchoolClassroomsDto,
  ListSchoolTeacherCandidatesDto,
  ListSchoolTeachersDto,
  SetClassroomFavoriteDto,
  UpdateClassroomPresentationDto,
  UpdateSchoolClassroomDto,
  UpdateSchoolTeacherMembershipDto,
} from './dto/school-structure.dto';
import { multerConfig } from '../common/interceptors/file-upload.interceptor';
import { SchoolStructureService } from './school-structure.service';

@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermission('manage-school-structure')
@Controller('api/school-structure')
export class SchoolStructureController {
  constructor(private readonly service: SchoolStructureService) {}

  @Get('student-problem-categories')
  @RequirePermission()
  @RequireAnyPermission('classrooms', 'manage-school-structure', 'attendance', 'students')
  listStudentProblemCategories() {
    return this.service.listStudentProblemCategories();
  }

  @Get('schools')
  @RequirePermission()
  @RequireAnyPermission(
    'manage-school-structure',
    'import-data',
    'manage-role-groups',
    'manage-teachers',
  )
  listSchools(@CurrentUser() actor: AuthenticatedRequestUser) {
    return this.service.listSchools(actor);
  }

  @Get('classrooms')
  @RequirePermission()
  @RequireAnyPermission('manage-school-structure', 'import-data')
  listClassrooms(
    @Query() query: ListSchoolClassroomsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listClassrooms(query, actor);
  }

  @Get('classrooms/options')
  @RequirePermission()
  @RequireAnyPermission('manage-school-structure', 'import-data')
  listClassroomOptions(
    @Query() query: ListSchoolClassroomOptionsDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listClassroomOptions(query, actor);
  }

  @Get('classrooms/:classroomId')
  @RequirePermission()
  @RequireAnyPermission('classrooms', 'manage-school-structure', 'attendance')
  getClassroom(
    @Param('classroomId', ParseIntPipe) classroomId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.getClassroom(classroomId, actor);
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

  @Put('classrooms/:classroomId/favorite')
  setClassroomFavorite(
    @Param('classroomId', ParseIntPipe) classroomId: number,
    @Body() body: SetClassroomFavoriteDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.setClassroomFavorite(classroomId, body.isFavorite, actor);
  }

  @Patch('classrooms/:classroomId/presentation')
  @UseInterceptors(FileInterceptor('photo', multerConfig))
  updateClassroomPresentation(
    @Param('classroomId', ParseIntPipe) classroomId: number,
    @Body() body: UpdateClassroomPresentationDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.updateClassroomPresentation(classroomId, body, actor, file);
  }

  @Get('classrooms/:classroomId/cover')
  async getClassroomCover(
    @Param('classroomId', ParseIntPipe) classroomId: number,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.service.resolveClassroomCover(classroomId, actor);
    // Do not cache a redirect to a short-lived Supabase signed URL.
    res.setHeader('Cache-Control', 'private, no-store');
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    res.sendFile(result.filePath);
  }

  @Get('teachers')
  @RequirePermission()
  @RequireAnyPermission('manage-school-structure')
  listTeachers(
    @Query() query: ListSchoolTeachersDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listTeachers(query, actor);
  }

  @Get('teachers/options')
  @RequirePermission()
  @RequireAnyPermission('manage-school-structure')
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

  // The comment dialog is opened from both the classroom page and เช็กชื่อ.
  @Post('classrooms/:classroomId/students/:studentUuid/comments')
  @RequirePermission()
  @RequireAnyPermission('classrooms', 'manage-school-structure', 'attendance')
  createStudentComment(
    @Param('classroomId', ParseIntPipe) classroomId: number,
    @Param('studentUuid', ParseUUIDPipe) studentUuid: string,
    @Body() body: CreateClassroomStudentCommentDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.createStudentComment(classroomId, studentUuid, body, actor);
  }

  // Roster export is offered on the classroom page and on เช็กชื่อ.
  @Post('classrooms/:classroomId/export-events')
  @RequirePermission()
  @RequireAnyPermission('classrooms', 'manage-school-structure', 'export-data', 'attendance')
  authorizeClassroomExport(
    @Param('classroomId', ParseIntPipe) classroomId: number,
    @Body() body: AuthorizeClassroomExportDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.authorizeClassroomExport(classroomId, body, actor);
  }

  @Get('classrooms/:classroomId/attendance-history')
  @RequirePermission()
  @RequireAnyPermission('classrooms', 'manage-school-structure', 'attendance')
  listClassroomAttendanceHistory(
    @Param('classroomId', ParseIntPipe) classroomId: number,
    @Query() query: ListClassroomAttendanceHistoryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    return this.service.listClassroomAttendanceHistory(classroomId, query, actor);
  }
}
