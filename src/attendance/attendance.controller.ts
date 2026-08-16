import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  resolveActorDataScope,
  type AuthenticatedRequestUser,
} from '../auth';
import { AttendanceImportService } from './attendance-import.service';
import { attendanceImportMulterOptions } from './attendance-import.multer';
import {
  ListAttendanceImportsDto,
  ParseAttendanceImportDto,
  RecordAttendanceImportDto,
} from './dto/attendance-import.dto';
import type { Response } from 'express';
import { buildPaginationMeta } from '../common/pagination/pagination.util';
import { AttendanceService } from './attendance.service';
import {
  GetHistoryQueryDto,
  GetRoomsQueryDto,
  GetSchoolsQueryDto,
  GetStudentsQueryDto,
  SaveAttendanceDto,
  SaveAttendanceMarksDto,
} from './dto/attendance.dto';
import { resolveLimit, resolvePage } from '../common/pagination/pagination.util';
import { AttendanceOperationsService } from './attendance-operations.service';
import {
  AttendanceReconciliationQueryDto,
  AttendanceReconciliationAnomaliesQueryDto,
  AttendanceSessionContextQueryDto,
  GenerateSchoolCalendarDto,
  ListSchoolCalendarQueryDto,
  ListSchoolTermsQueryDto,
  ReopenAttendanceSessionDto,
  UpdateSchoolCalendarDayDto,
  UpsertSchoolTermDto,
} from './dto/attendance-operations.dto';

@UseGuards(AuthGuard)
@Controller('api/attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly attendanceOperationsService: AttendanceOperationsService,
    private readonly attendanceImportService: AttendanceImportService,
  ) {}

  @Get('grade-levels')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission(
    'attendance',
    'attendance-dashboard',
    'students',
    'manage-school-structure',
    'export-data',
  )
  async getGradeLevels() {
    return await this.attendanceService.getGradeLevels();
  }

  @Get('schools')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission(
    'attendance',
    'attendance-dashboard',
    'students',
    'manage-school-structure',
    'import-data',
    'import-school-roster',
    'export-data',
  )
  async getSchools(
    @Query() query: GetSchoolsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceService.getSchools(
      query.province,
      query.district,
      query.subDistrict,
      query.searchTerm,
      query.limit,
      resolveActorDataScope(actor),
    );
  }

  @Get('students')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async getStudents(
    @Query() query: GetStudentsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceService.getStudents(
      query.grade,
      query.room,
      query.schoolId,
      resolveActorDataScope(actor),
    );
  }

  @Get('history')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async getHistory(
    @Query() query: GetHistoryQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    const schoolId = query.schoolId ? Number(query.schoolId) : null;
    return await this.attendanceService.getHistory(
      query.date,
      resolveActorDataScope(actor),
      Number.isInteger(schoolId) ? schoolId : null,
      query.sessionKind,
      query.timetableSlotId,
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
    return await this.attendanceService.saveAttendance(
      body.records,
      actor,
      body.timetable_slot_id,
      body.date,
    );
  }

  // Same permission as the final submit: a draft is still an attendance write,
  // it just does not close the round. Scope is enforced server-side as usual.
  @Post('marks')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async saveAttendanceMarks(
    @Body() body: SaveAttendanceMarksDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceService.saveDraftMarks(
      body.records ?? [],
      actor,
      body.timetable_slot_id,
      body.date,
      body.cleared_student_ids ?? [],
    );
  }

  // Reads a teacher-supplied spreadsheet into plain rows. It writes nothing and
  // returns no student data, so the same 'attendance' permission that guards a
  // check-in is the right gate; matching rows to the roster happens client-side
  // and any resulting marks still go through the guarded write endpoints above.
  @Post('import/parse')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  @UseInterceptors(FileInterceptor('file', attendanceImportMulterOptions))
  async parseImport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: ParseAttendanceImportDto,
  ) {
    if (file) {
      return { data: this.attendanceImportService.parseUpload(file) };
    }
    if (!body.url) {
      throw new BadRequestException('กรุณาเลือกไฟล์หรือใส่ลิงก์');
    }
    return { data: await this.attendanceImportService.parseUrl(body.url) };
  }

  // Provenance of an applied import: the file (or the link) that produced the
  // marks, kept so ประวัติ → นำเข้าไฟล์ can show who imported what.
  @Post('imports')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  @UseInterceptors(FileInterceptor('file', attendanceImportMulterOptions))
  async recordImport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: RecordAttendanceImportDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    // The classroom is the scope authority: it decides the school and term the
    // row is filed under, so a caller cannot file an import against a class
    // outside their scope by naming a school of their own.
    const classroom = await this.attendanceOperationsService.assertClassroomAccess(
      body.classroomId,
      actor,
    );
    const recorded = await this.attendanceImportService.recordApplied({
      schoolId: classroom.schoolId,
      schoolTermId: classroom.schoolTermId,
      classroomId: body.classroomId,
      attendanceDate: body.attendanceDate,
      timetableSlotId: body.timetableSlotId ?? null,
      subjectId: body.subjectId ?? null,
      fileName: body.fileName,
      sourceUrl: body.sourceUrl ?? null,
      rowCount: body.rowCount,
      appliedCount: body.appliedCount,
      importedBy: actor.id,
      importedByLabel:
        [actor.FirstName, actor.LastName].filter(Boolean).join(' ').trim() || actor.username,
      file,
    });
    return { data: recorded };
  }

  @Get('imports')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission('attendance', 'attendance-dashboard')
  async listImports(
    @Query() query: ListAttendanceImportsDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    await this.attendanceOperationsService.assertClassroomAccess(query.classroomId, actor);
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const result = await this.attendanceImportService.listApplied({
      classroomId: query.classroomId,
      subjectId: query.subjectId,
      attendanceDate: query.attendanceDate,
      search: query.search,
      sortBy: query.sortBy,
      sortDirection: query.sortDirection,
      page,
      limit,
    });
    return {
      data: result.rows,
      meta: buildPaginationMeta(page, limit, result.totalCount),
    };
  }

  @Get('imports/:id/file')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission('attendance', 'attendance-dashboard')
  async downloadImport(
    @Param('id', ParseIntPipe) id: number,
    @Query('classroomId', ParseIntPipe) classroomId: number,
    @Res({ passthrough: true }) response: Response,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    // The stored sheet lists student ids and full names, so the classroom it
    // belongs to has to be inside the actor's scope, not merely match the row.
    await this.attendanceOperationsService.assertClassroomAccess(classroomId, actor);
    const { stream, fileName } = await this.attendanceImportService.openApplied(id, classroomId);
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(fileName)}"`,
    );
    return new StreamableFile(stream);
  }

  @Get('rooms')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission('attendance', 'attendance-dashboard', 'students', 'export-data')
  async getRooms(
    @Query() query: GetRoomsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceService.getRooms(
      query.grade,
      query.schoolId,
      resolveActorDataScope(actor),
    );
  }

  @Get('terms')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission(
    'attendance-dashboard',
    'manage-attendance-calendar',
    'manage-school-structure',
    'import-data',
    'import-school-roster',
  )
  async listTerms(
    @Query() query: ListSchoolTermsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.listTerms(query.schoolId, actor);
  }

  @Post('terms')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission('manage-attendance-calendar', 'manage-school-structure')
  async upsertTerm(
    @Body() body: UpsertSchoolTermDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.upsertTerm(body, actor);
  }

  @Post('terms/:termId/calendar/generate')
  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-attendance-calendar')
  async generateCalendar(
    @Param('termId', ParseIntPipe) termId: number,
    @Body() body: GenerateSchoolCalendarDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.generateCalendar(termId, body.schoolDays, actor);
  }

  @Get('calendar')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission('attendance-dashboard', 'manage-attendance-calendar')
  async listCalendar(
    @Query() query: ListSchoolCalendarQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.listCalendar(query.termId, actor);
  }

  @Patch('calendar-days/:calendarDayId')
  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-attendance-calendar')
  async updateCalendarDay(
    @Param('calendarDayId', ParseIntPipe) calendarDayId: number,
    @Body() body: UpdateSchoolCalendarDayDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.updateCalendarDay(
      calendarDayId,
      body.dayType,
      body.reason,
      actor,
    );
  }

  @Get('session')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async getSessionContext(
    @Query() query: AttendanceSessionContextQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.getSessionContext(
      query.schoolId,
      query.grade,
      query.room,
      query.date,
      actor,
      query.timetableSlotId,
    );
  }

  @Post('sessions/:sessionId/reopen')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async reopenSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: ReopenAttendanceSessionDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.reopenSession(sessionId, body.reason, actor);
  }

  @Get('reconciliation')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance-dashboard')
  async getReconciliation(
    @Query() query: AttendanceReconciliationQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.getReconciliation(
      query.termId,
      query.date,
      resolvePage(query.page),
      resolveLimit(query.limit),
      actor,
      query.gradeLevelId,
      query.room,
    );
  }

  @Get('reconciliation/anomalies')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance-dashboard')
  async getReconciliationAnomalies(
    @Query() query: AttendanceReconciliationAnomaliesQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.getReconciliationAnomalies(
      query.termId,
      resolvePage(query.page),
      resolveLimit(query.limit),
      actor,
      query.gradeLevelId,
      query.room,
    );
  }
}
