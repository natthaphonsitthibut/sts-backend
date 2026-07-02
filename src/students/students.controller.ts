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
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuditLogService, type AuditAction } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import {
  AuthGuard,
  CurrentUser,
  normalizeDataScope,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  type AuthenticatedRequestUser,
} from '../auth';
import { StudentsService } from './students.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { GetStudentFilterOptionsQueryDto, GetStudentsQueryDto } from './dto/students.dto';
import { PiiRevealDto } from './dto/pii-reveal.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return typeof value === 'string' && value.length > 0 ? value : null;
}

@UseGuards(AuthGuard)
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
  findAll(@Query() query: GetStudentsQueryDto, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.findAll(query, normalizeDataScope(actor?.data_scope), actor);
  }

  // Declared before the dynamic `:id` route so the static segment isn't
  // captured as a student id.
  @Get('filter-options')
  getFilterOptions(
    @Query() query: GetStudentFilterOptionsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.getFilterOptions(query, normalizeDataScope(actor?.data_scope));
  }

  @Get('cases/by-name/:name')
  findCasesByName(@Param('name') name: string, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.findCasesByName(name, actor);
  }

  @Get('attendance/:id')
  findAttendanceByStudentId(
    @Param('id') id: string,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return this.studentsService.findAttendanceByStudentId(
      id,
      actor,
      normalizeDataScope(actor?.data_scope),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() actor?: AuthenticatedRequestUser) {
    return this.studentsService.findOne(id, actor, normalizeDataScope(actor?.data_scope));
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
    return this.studentsService.revealPii(id, actor, normalizeDataScope(actor?.data_scope), body, {
      ip: req.ip ?? null,
      userAgent: firstHeaderValue(req.headers['user-agent']),
      requestId: firstHeaderValue(req.headers['x-request-id']),
    });
  }

  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('edit-students')
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
      normalizeDataScope(actor?.data_scope),
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
