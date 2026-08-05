import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
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
  @RequirePermission('edit-students')
  @Post()
  async create(
    @Body() createStudentDto: CreateStudentDto,
    @Req() req: Request,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    const result = this.studentsService.create(createStudentDto);
    await this.recordStudentWriteAudit('STUDENT_CREATE', actor, req, null, createStudentDto);
    return result;
  }

  @Get()
  @RequirePermission('students')
  findAll(@Query() query: GetStudentsQueryDto, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.findAll(query, resolveActorDataScope(actor), actor);
  }

  // Declared before the dynamic `:id` route so the static segment isn't
  // captured as a student id.
  @Get('filter-options')
  @RequirePermission('students')
  getFilterOptions(
    @Query() query: GetStudentFilterOptionsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.getFilterOptions(query, resolveActorDataScope(actor), actor);
  }

  @Get('cases/by-name/:name')
  @RequirePermission('students')
  findCasesByName(@Param('name') name: string, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.findCasesByName(name, actor, resolveActorDataScope(actor));
  }

  @Get(':id/cases')
  @RequirePermission('students')
  findCasesByStudentId(@Param('id') id: string, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.findCasesByStudentId(id, actor, resolveActorDataScope(actor));
  }

  @Get('attendance/:id')
  @RequireAnyPermission('students', 'student-self')
  findAttendanceByStudentId(
    @Param('id') id: string,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.findAttendanceByStudentId(id, actor, resolveActorDataScope(actor));
  }

  @Get(':id/profile-summary')
  @RequireAnyPermission('students', 'student-self')
  getStudentProfileSummary(
    @Param('id') id: string,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.getStudentProfileSummary(id, actor, resolveActorDataScope(actor));
  }

  @Get(':id/attendance-subjects')
  @RequireAnyPermission('students', 'student-self')
  getStudentSubjectAttendance(
    @Param('id') id: string,
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
  @RequireAnyPermission('students', 'student-self')
  findOne(@Param('id') id: string, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.findOne(id, actor, resolveActorDataScope(actor));
  }

  /**
   * Profile photo read. Served through the app so the student scope check runs
   * before the bytes do; the adapter hands back a short-lived signed URL.
   */
  @Get(':id/photo')
  @RequireAnyPermission('students', 'student-self')
  async getStudentPhoto(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ): Promise<void> {
    const result = await this.studentsService.resolveStudentPhoto(
      id,
      actor,
      resolveActorDataScope(actor),
    );
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (result.kind === 'redirect') {
      res.redirect(302, result.url);
      return;
    }
    res.sendFile(result.filePath);
  }

  // Students may replace their own photo; staff need the edit permission. The
  // service still runs assertOwnStudentAccess for a student actor.
  @RequireAnyPermission('edit-students', 'student-self')
  @Patch(':id/photo')
  @UseInterceptors(FileInterceptor('photo', multerConfig))
  async updateStudentPhoto(
    @Param('id') id: string,
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

  // Reveal a masked PII group (national id / passport) for one student. Staff
  // need `students`; student self-access uses `student-self` and is still
  // limited by assertOwnStudentAccess in the service.
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequireAnyPermission('students', 'student-self')
  @Post(':id/pii-reveal')
  revealPii(
    @Param('id') id: string,
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

  // Students may PATCH their own record too, but the service restricts an
  // own-only student actor to contact/guardian fields (never name/address).
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequireAnyPermission('edit-students', 'student-self')
  @Patch(':id')
  async update(
    @Param('id') id: string,
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
  @RequirePermission('edit-students')
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Req() req: Request,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    const result = this.studentsService.remove(+id);
    await this.recordStudentWriteAudit('STUDENT_DELETE', actor, req, id, {});
    return result;
  }
}
