import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { multerConfig } from '../common/interceptors/file-upload.interceptor';
import { AuditLogService, type AuditAction } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import {
  AuthGuard,
  CurrentUser,
  resolveActorDataScope,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import {
  GetStudentFilterOptionsQueryDto,
  GetStudentsQueryDto,
  GetStudentSubjectAttendanceQueryDto,
  UpdateStudentPhotoDto,
} from './dto/students.dto';
import { PiiRevealDto } from './dto/pii-reveal.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { CorrectStudentNationalIdDto } from './dto/correct-student-national-id.dto';
import { MasterDataService } from '../master-data/master-data.service';

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === 'string' && value.length > 0 ? value : null;
}

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('api/students')
export class StudentsController {
  private readonly logger = new Logger(StudentsController.name);

  constructor(
    private readonly studentsService: StudentsService,
    private readonly auditLog: AuditLogService,
    private readonly masterData: MasterDataService,
  ) {}

  private async recordStudentWriteAudit(
    action: AuditAction,
    actor: AuthenticatedRequestUser | undefined,
    req: Request,
    targetId: string | null,
    payload: object,
  ): Promise<void> {
    try {
      await this.auditLog.record({
        action,
        actorUserId: resolveAuditActorId(actor),
        actorLabel: actor?.username,
        targetType: 'student',
        targetId,
        metadata: {
          fieldCount: Object.keys(payload).length,
          fields: Object.keys(payload),
        },
        ip: req.ip ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`${action} audit failed: ${message}`);
    }
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-students')
  @Post()
  async create(
    @Body() createStudentDto: CreateStudentDto,
    @Req() req: Request,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    const result = await this.studentsService.create(
      createStudentDto,
      actor,
      resolveActorDataScope(actor),
    );
    const targetId = typeof result.id === 'string' ? result.id : null;
    await this.recordStudentWriteAudit('STUDENT_CREATE', actor, req, targetId, createStudentDto);
    return result;
  }

  @Get()
  @RequireAnyPermission('students', 'manage-students')
  findAll(@Query() query: GetStudentsQueryDto, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.findAll(query, resolveActorDataScope(actor), actor);
  }

  // Declared before the dynamic `:id` route so the static segment isn't
  // captured as a student id.
  @Get('filter-options')
  @RequireAnyPermission('students', 'manage-students')
  getFilterOptions(
    @Query() query: GetStudentFilterOptionsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.getFilterOptions(query, resolveActorDataScope(actor), actor);
  }

  @Get('management-options')
  @RequirePermission('manage-students')
  getManagementOptions(@CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.getManagementOptions(resolveActorDataScope(actor));
  }

  @Get('care-options')
  @RequirePermission('manage-students')
  async getCareOptions() {
    const [disadvantages, disabilities] = await Promise.all([
      this.masterData.listActiveOptions('disadvantage-types'),
      this.masterData.listActiveOptions('disability-types'),
    ]);
    return { success: true, data: { disadvantages, disabilities } };
  }

  @Get('cases/by-name/:name')
  @RequireAnyPermission('students', 'manage-students')
  findCasesByName(@Param('name') name: string, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.findCasesByName(name, actor, resolveActorDataScope(actor));
  }

  @Get(':id/cases')
  @RequireAnyPermission('students', 'manage-students', 'classrooms')
  findCasesByStudentId(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.findCasesByStudentId(id, actor, resolveActorDataScope(actor));
  }

  @Get('attendance/:id')
  @RequireAnyPermission('students', 'manage-students', 'classrooms')
  findAttendanceByStudentId(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.findAttendanceByStudentId(id, actor, resolveActorDataScope(actor));
  }

  @Get(':id/profile-summary')
  @RequireAnyPermission('students', 'manage-students', 'classrooms')
  getStudentProfileSummary(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.getStudentProfileSummary(id, actor, resolveActorDataScope(actor));
  }

  @Get(':id/attendance-subjects')
  @RequireAnyPermission('students', 'manage-students', 'classrooms')
  getStudentSubjectAttendance(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: GetStudentSubjectAttendanceQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.getStudentSubjectAttendance(
      id,
      query.date,
      actor,
      resolveActorDataScope(actor),
    );
  }

  @Get(':id')
  @RequireAnyPermission('students', 'manage-students', 'classrooms')
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.findOne(id, actor, resolveActorDataScope(actor));
  }

  /**
   * Profile photo read. Served through the app so the scoped access check runs
   * before the bytes do; the adapter hands back a short-lived signed URL.
   *
   * A student's avatar appears on เช็กชื่อ, ห้องเรียนทั้งหมด, รายงานสถานะนักเรียน,
   * เคส and รายชื่อนักเรียน, so it is reachable from every one of those pages —
   * the rule the owner picked on 2026-08-17. Narrowing this to `students` alone
   * would leave a group built around เช็กชื่อ with a roster of broken images.
   * The data scope, not the page, still decides *which* students.
   */
  @Get(':id/photo')
  @RequireAnyPermission(
    'students',
    'manage-students',
    'attendance',
    'classrooms',
    'dashboard',
    'manage-school-structure',
  )
  async getStudentPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ): Promise<void> {
    const result = await this.studentsService.resolveStudentPhoto(
      id,
      actor,
      resolveActorDataScope(actor),
    );
    // Do not cache a redirect to a short-lived Supabase signed URL.
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    res.sendFile(result.filePath);
  }

  @RequireAnyPermission('students', 'manage-students')
  @Patch(':id/photo')
  @UseInterceptors(FileInterceptor('photo', multerConfig))
  async updateStudentPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() data: UpdateStudentPhotoDto,
    @Req() req: Request,
    @CurrentUser() actor?: AuthenticatedRequestUser,
    @UploadedFile() photo?: Express.Multer.File,
  ) {
    const result = await this.studentsService.updateStudentPhoto(
      id,
      actor,
      resolveActorDataScope(actor),
      photo,
      data.removePhoto,
    );
    await this.recordStudentWriteAudit('STUDENT_UPDATE', actor, req, id, {
      op: photo ? 'update-photo' : 'remove-photo',
    });
    return result;
  }

  // Reveal a masked PII group (national id / passport) for one student.
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-students')
  @Post(':id/pii-reveal')
  revealPii(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: PiiRevealDto,
    @Req() req: Request,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.revealPii(id, actor, resolveActorDataScope(actor), body, {
      ip: req.ip ?? null,
      userAgent: firstHeaderValue(req.headers['user-agent']),
      requestId: firstHeaderValue(req.headers['x-request-id']),
    });
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-students')
  @Patch(':id/national-id')
  correctNationalId(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CorrectStudentNationalIdDto,
    @Req() req: Request,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.correctNationalId(id, body, actor, resolveActorDataScope(actor), {
      ip: req.ip ?? null,
    });
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-students')
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateStudentDto: UpdateStudentDto,
    @Req() req: Request,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    const result = await this.studentsService.update(
      id,
      updateStudentDto,
      actor,
      resolveActorDataScope(actor),
    );
    await this.recordStudentWriteAudit('STUDENT_UPDATE', actor, req, id, updateStudentDto);
    return result;
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('manage-students')
  @Delete(':id')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    const result = this.studentsService.remove(+id);
    await this.recordStudentWriteAudit('STUDENT_DELETE', actor, req, id, {});
    return result;
  }
}
