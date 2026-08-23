import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser, PermissionsGuard, RequirePermission } from '../auth';
import type { AuthenticatedRequestUser } from '../auth';
import {
  AddSchoolSubjectDto,
  ListGradeSchoolSubjectsQueryDto,
  ListSchoolSubjectsQueryDto,
  ListSubjectGradesQueryDto,
  ReplaceClassroomSubjectsDto,
  SaveGradeSchoolSubjectDto,
  UpdateSchoolSubjectDto,
} from './dto/subjects.dto';
import { SubjectsService } from './subjects.service';

@UseGuards(AuthGuard)
@Controller('api/subjects')
export class SubjectsController {
  constructor(private readonly subjectsService: SubjectsService) {}

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-subjects')
  @Get('school-catalog/grades')
  async listSubjectGrades(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Query() query: ListSubjectGradesQueryDto,
  ) {
    return await this.subjectsService.listSubjectGrades(actor, query);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-subjects')
  @Get('school-catalog/grade-subjects')
  async listGradeSchoolSubjects(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Query() query: ListGradeSchoolSubjectsQueryDto,
  ) {
    return await this.subjectsService.listGradeSchoolSubjects(actor, query);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-subjects')
  @Get('school-catalog/grade-subjects/:schoolSubjectId')
  async getGradeSchoolSubject(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('schoolSubjectId', ParseIntPipe) schoolSubjectId: number,
    @Query() query: ListGradeSchoolSubjectsQueryDto,
  ) {
    return await this.subjectsService.getGradeSchoolSubject(actor, schoolSubjectId, query);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-subjects')
  @Post('school-catalog/grade-subjects')
  async createGradeSchoolSubject(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() body: SaveGradeSchoolSubjectDto,
  ) {
    return await this.subjectsService.saveGradeSchoolSubject(actor, null, body);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-subjects')
  @Put('school-catalog/grade-subjects/:schoolSubjectId')
  async updateGradeSchoolSubject(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('schoolSubjectId', ParseIntPipe) schoolSubjectId: number,
    @Body() body: SaveGradeSchoolSubjectDto,
  ) {
    return await this.subjectsService.saveGradeSchoolSubject(actor, schoolSubjectId, body);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-subjects')
  @Delete('school-catalog/grade-subjects/:schoolSubjectId')
  async removeGradeSchoolSubject(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('schoolSubjectId', ParseIntPipe) schoolSubjectId: number,
    @Query() query: ListGradeSchoolSubjectsQueryDto,
  ) {
    return await this.subjectsService.removeGradeSchoolSubject(actor, schoolSubjectId, query);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-subjects')
  @Get('school-catalog')
  async listSchoolCatalog(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Query() query: ListSchoolSubjectsQueryDto,
  ) {
    return await this.subjectsService.listSchoolCatalog(actor, query);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-subjects')
  @Post('school-catalog')
  async addSchoolSubject(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Body() body: AddSchoolSubjectDto,
  ) {
    return await this.subjectsService.addSchoolSubject(actor, body);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-subjects')
  @Patch('school-catalog/:schoolSubjectId')
  async updateSchoolSubject(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('schoolSubjectId', ParseIntPipe) schoolSubjectId: number,
    @Body() body: UpdateSchoolSubjectDto,
  ) {
    return await this.subjectsService.updateSchoolSubject(actor, schoolSubjectId, body);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-subjects')
  @Get('classrooms/:classroomId/offerings')
  async listClassroomOfferings(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('classroomId', ParseIntPipe) classroomId: number,
  ) {
    return await this.subjectsService.listClassroomOfferings(actor, classroomId);
  }

  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-subjects')
  @Put('classrooms/:classroomId/offerings')
  async replaceClassroomOfferings(
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Param('classroomId', ParseIntPipe) classroomId: number,
    @Body() body: ReplaceClassroomSubjectsDto,
  ) {
    return await this.subjectsService.replaceClassroomOfferings(actor, classroomId, body);
  }
}
