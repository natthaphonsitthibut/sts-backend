import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  AuthGuard,
  CurrentUser,
  PermissionsGuard,
  RequireAnyPermission,
  RequirePermission,
  resolveActorDataScope,
  type AuthenticatedRequestUser,
} from '../auth';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { attendanceImportMulterOptions } from './attendance-import.multer';
import { AttendanceImportService } from './attendance-import.service';
import { ParseAttendanceImportDto } from './dto/attendance-import.dto';
import { AttendanceService } from './attendance.service';
import {
  GetHistoryQueryDto,
  GetRoomsQueryDto,
  GetSchoolsQueryDto,
  GetStudentsQueryDto,
} from './dto/attendance.dto';
import { AttendanceOperationsService } from './attendance-operations.service';
import { ListSchoolTermsQueryDto, UpsertSchoolTermDto } from './dto/attendance-operations.dto';
import {
  InternalCheckInOptionsQueryDto,
  InternalCheckInRosterQueryDto,
  InternalCheckInSessionQueryDto,
  StartInternalExceptionAttendanceDto,
  SubmitExceptionAttendanceDto,
} from './dto/exception-attendance.dto';
import { ExceptionAttendanceService } from './exception-attendance.service';

@UseGuards(AuthGuard)
@Controller('api/attendance')
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly attendanceOperationsService: AttendanceOperationsService,
    private readonly exceptionAttendanceService: ExceptionAttendanceService,
    private readonly attendanceImportService: AttendanceImportService,
  ) {}

  @Get('check-in/options')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async checkInOptions(
    @Query() query: InternalCheckInOptionsQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    const checkInActor = await this.exceptionAttendanceService.resolveInternalActor(
      query.classroomId,
      actor,
    );
    return await this.exceptionAttendanceService.getOptions(checkInActor, query.date);
  }

  @Get('check-in/roster')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async checkInRoster(
    @Query() query: InternalCheckInRosterQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    const checkInActor = await this.exceptionAttendanceService.resolveInternalActor(
      query.classroomId,
      actor,
    );
    return await this.exceptionAttendanceService.getRoster(checkInActor, {
      date: query.date,
      classroomSubjectId: query.classroomSubjectId,
    });
  }

  @Get('check-in/student-photo')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async checkInStudentPhoto(
    @Query('classroomId', ParseIntPipe) classroomId: number,
    @Query('studentId', ParseUUIDPipe) studentId: string,
    @CurrentUser() actor: AuthenticatedRequestUser,
    @Res() response: Response,
  ): Promise<void> {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const checkInActor = await this.exceptionAttendanceService.resolveInternalActor(
      classroomId,
      actor,
    );
    const result = await this.exceptionAttendanceService.resolveStudentPhoto(
      checkInActor,
      studentId,
    );
    if (result.kind === 'redirect') {
      response.redirect(302, result.url);
      return;
    }
    response.sendFile(result.filePath);
  }

  @Get('check-in/sessions/current')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async currentCheckInSession(
    @Query() query: InternalCheckInSessionQueryDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    const checkInActor = await this.exceptionAttendanceService.resolveInternalActor(
      query.classroomId,
      actor,
    );
    return await this.exceptionAttendanceService.findLessonSession(checkInActor, {
      date: query.date,
      classroomSubjectId: query.classroomSubjectId,
    });
  }

  @Post('check-in/sessions/start')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async startCheckInSession(
    @Body() body: StartInternalExceptionAttendanceDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    const checkInActor = await this.exceptionAttendanceService.resolveInternalActor(
      body.classroomId,
      actor,
    );
    return await this.exceptionAttendanceService.start(checkInActor, body);
  }

  @Post('check-in/sessions/:sessionId/submit')
  @UseGuards(PermissionsGuard)
  @RequirePermission('attendance')
  async submitCheckInSession(
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() body: SubmitExceptionAttendanceDto,
    @CurrentUser() actor: AuthenticatedRequestUser,
  ) {
    const checkInActor = await this.exceptionAttendanceService.getInternalActorForSession(
      sessionId,
      actor,
    );
    return await this.exceptionAttendanceService.submit(checkInActor, sessionId, body);
  }

  @Get('grade-levels')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission(
    'attendance',
    'students',
    'manage-school-structure',
    'manage-classroom-links',
    'export-data',
  )
  async getGradeLevels() {
    return await this.attendanceService.getGradeLevels();
  }

  @Get('schools')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission(
    'attendance',
    'students',
    'manage-school-structure',
    'import-data',
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
    );
  }

  @Get('rooms')
  @UseGuards(PermissionsGuard)
  @RequireAnyPermission('attendance', 'students', 'export-data')
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
    'attendance',
    'manage-school-structure',
    'manage-classroom-links',
    'manage-subjects',
    'import-data',
  )
  async listTerms(
    @Query() query: ListSchoolTermsQueryDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.listTerms(query.schoolId, actor);
  }

  @Post('terms')
  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-school-structure')
  async upsertTerm(
    @Body() body: UpsertSchoolTermDto,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.upsertTerm(body, actor);
  }

  @Delete('terms/:termId')
  @UseGuards(PermissionsGuard)
  @RequirePermission('manage-school-structure')
  async deleteTerm(
    @Param('termId', ParseIntPipe) termId: number,
    @CurrentUser() actor?: AuthenticatedRequestUser,
  ) {
    return await this.attendanceOperationsService.deleteTerm(termId, actor);
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
}
