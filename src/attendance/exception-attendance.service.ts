import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { getBangkokDateString, getBangkokDayBounds } from '../common/utils/date.util';
import {
  FILE_STORAGE_ADAPTER,
  type FileServeResult,
  type FileStorageAdapter,
} from '../files/storage/file-storage.types';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { MasterDataService } from '../master-data/master-data.service';
import { AttendanceOperationsService } from './attendance-operations.service';
import { ATTENDANCE_STATUS_CODE } from './attendance-status';
import type {
  AttendanceExceptionDto,
  StartExceptionAttendanceDto,
  SubmitExceptionAttendanceDto,
} from './dto/exception-attendance.dto';
import { ExceptionAttendanceRepository } from './exception-attendance.repository';
import type {
  CheckInClassroomRow,
  ExceptionAttendanceActor,
  ExceptionAttendanceSessionRow,
  PreparedAttendanceException,
  StoredAttendanceExceptionRow,
} from './exception-attendance.types';

@Injectable()
export class ExceptionAttendanceService {
  private readonly logger = new Logger(ExceptionAttendanceService.name);

  constructor(
    private readonly repository: ExceptionAttendanceRepository,
    private readonly attendanceOperations: AttendanceOperationsService,
    private readonly audit: AuditLogService,
    private readonly riskProfiles: RiskProfileService,
    private readonly masterData: MasterDataService,
    @Inject(FILE_STORAGE_ADAPTER) private readonly storage: FileStorageAdapter,
  ) {}

  private assertActorMatches(
    actor: ExceptionAttendanceActor,
    classroom: CheckInClassroomRow,
  ): void {
    if (
      actor.schoolId !== Number(classroom.school_id) ||
      actor.classroomId !== Number(classroom.classroom_id)
    ) {
      throw new NotFoundException('ไม่พบห้องเรียนในขอบเขตของคุณ');
    }
  }

  private assertOperationalClassroom(classroom: CheckInClassroomRow): void {
    if (
      classroom.school_status !== 'ACTIVE' ||
      classroom.classroom_status !== 'ACTIVE' ||
      classroom.term_status !== 'ACTIVE'
    ) {
      throw new ConflictException('ห้องเรียนหรือภาคเรียนไม่ได้เปิดใช้งาน');
    }
  }

  private toSessionResponse(
    session: ExceptionAttendanceSessionRow,
    exceptions: StoredAttendanceExceptionRow[] = [],
    idempotent = false,
  ) {
    return {
      id: session.id,
      classroomId: Number(session.classroom_id),
      classroomSubjectId: Number(session.classroom_subject_id),
      date: session.attendance_date,
      status: session.status,
      storageMode: session.record_storage_mode,
      checkingStartedAt: session.checking_started_at,
      submittedAt: session.submitted_at,
      expectedRosterCount: Number(session.expected_roster_count),
      recordedCount: Number(session.recorded_count),
      exceptionCount: Number(session.exception_count),
      revision: Number(session.revision),
      readOnly: session.status === 'SUBMITTED' || session.record_storage_mode !== 'EXCEPTIONS',
      idempotent,
      exceptions: exceptions.map((item) => ({
        studentId: item.student_uuid,
        status:
          Number(item.attendance_status_code) === 2
            ? ('P_ABSENT' as const)
            : Number(item.attendance_status_code) === 3
              ? ('P_LATE' as const)
              : ('P_LEAVE' as const),
        absenceReasonCode: item.absence_reason_code,
      })),
    };
  }

  async resolveInternalActor(
    classroomId: number,
    actor: AuthenticatedRequestUser,
  ): Promise<ExceptionAttendanceActor> {
    const classroomScope = await this.attendanceOperations.assertClassroomAccess(
      classroomId,
      actor,
    );
    const actorUserId = resolveAuditActorId(actor);
    return {
      source: 'INTERNAL',
      schoolId: classroomScope.schoolId,
      classroomId,
      actorUserId,
      teacherMembershipId: null,
      actorLabel:
        [actor.FirstName, actor.LastName].filter(Boolean).join(' ').trim() || actor.username,
    };
  }

  async getInternalActorForSession(
    sessionId: string,
    actor: AuthenticatedRequestUser,
  ): Promise<ExceptionAttendanceActor> {
    const session = await this.repository.findSessionById(sessionId);
    if (!session) throw new NotFoundException('ไม่พบรอบเช็กชื่อ');
    return await this.resolveInternalActor(Number(session.classroom_id), actor);
  }

  async getOptions(actor: ExceptionAttendanceActor, date: string) {
    const classroom = await this.repository.findClassroom(actor.classroomId);
    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
    this.assertActorMatches(actor, classroom);
    this.assertOperationalClassroom(classroom);
    const subjects = await this.repository.listSubjects(actor.classroomId);
    const absenceReasons = await this.masterData.listActiveOptions('absence-reasons');
    return {
      success: true,
      data: {
        date,
        classroom: {
          id: Number(classroom.classroom_id),
          schoolId: classroom.school_id,
          schoolName: classroom.school_name,
          schoolTermId: Number(classroom.school_term_id),
          academicYear: classroom.academic_year,
          semester: classroom.semester,
          gradeLabel: classroom.grade_label,
          roomNumber: classroom.legacy_room_number,
          roomName: classroom.room_name,
        },
        subjects: subjects.map((item) => ({
          classroomSubjectId: Number(item.classroom_subject_id),
          schoolSubjectId: Number(item.school_subject_id),
          subjectId: item.subject_id,
          code: item.code,
          nameTh: item.name_th,
        })),
        absenceReasons,
      },
    };
  }

  async getRoster(actor: ExceptionAttendanceActor) {
    const classroom = await this.repository.findClassroom(actor.classroomId);
    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
    this.assertActorMatches(actor, classroom);
    this.assertOperationalClassroom(classroom);
    const rows = await this.repository.listRoster(actor.classroomId);
    return {
      success: true,
      data: rows.map((row) => ({
        id: row.student_uuid,
        studentNumber: row.student_number,
        firstName: row.first_name,
        lastName: row.last_name,
        hasPhoto: row.has_photo,
        photoVersion: row.photo_updated_at ? new Date(row.photo_updated_at).toISOString() : null,
      })),
    };
  }

  async resolveStudentPhoto(
    actor: ExceptionAttendanceActor,
    studentUuid: string,
  ): Promise<FileServeResult> {
    const classroom = await this.repository.findClassroom(actor.classroomId);
    if (!classroom) throw new NotFoundException('ไม่พบห้องเรียน');
    this.assertActorMatches(actor, classroom);
    this.assertOperationalClassroom(classroom);
    const storageKey = await this.repository.findStudentPhotoStorageKey(
      actor.classroomId,
      studentUuid,
    );
    if (!storageKey) throw new NotFoundException('ไม่พบรูปประจำตัวนักเรียน');
    const result = await this.storage.resolve(storageKey);
    if (!result) throw new NotFoundException('ไม่พบรูปประจำตัวนักเรียน');
    return result;
  }

  async start(actor: ExceptionAttendanceActor, dto: StartExceptionAttendanceDto) {
    if (dto.date > getBangkokDateString()) {
      throw new BadRequestException('ไม่สามารถเช็กชื่อวันที่ในอนาคตได้');
    }
    const result = await this.repository.withTransaction(async (runner) => {
      const context = await this.repository.lockStartContext(
        actor.classroomId,
        dto.classroomSubjectId,
        dto.date,
        runner,
      );
      if (!context) throw new NotFoundException('ไม่พบรายวิชาของห้องเรียน');
      this.assertActorMatches(actor, context);
      this.assertOperationalClassroom(context);
      if (
        !context.starts_on ||
        !context.ends_on ||
        dto.date < context.starts_on ||
        dto.date > context.ends_on
      ) {
        throw new BadRequestException('วันที่เช็กชื่ออยู่นอกช่วงภาคเรียน');
      }
      if (context.calendar_day_type !== 'SCHOOL_DAY') {
        throw new BadRequestException('วันที่เลือกไม่ใช่วันเรียนตามปฏิทินโรงเรียน');
      }
      if (
        await this.repository.hasLegacyFullRosterSession(
          {
            schoolTermId: context.school_term_id,
            classroomId: context.classroom_id,
            subjectId: context.subject_id,
            attendanceDate: dto.date,
          },
          runner,
        )
      ) {
        throw new ConflictException('วิชานี้มีผลเช็กชื่อรูปแบบเดิมในวันนี้แล้ว');
      }
      const created = await this.repository.insertTargetSession(
        { context, attendanceDate: dto.date, actor },
        runner,
      );
      const session = await this.repository.findTargetSessionForUpdate(
        {
          schoolTermId: context.school_term_id,
          classroomId: context.classroom_id,
          classroomSubjectId: context.classroom_subject_id,
          attendanceDate: dto.date,
        },
        runner,
      );
      if (!session) throw new ConflictException('ไม่สามารถเริ่มรอบเช็กชื่อได้');
      if (session.status === 'VOIDED') throw new ConflictException('รอบเช็กชื่อนี้ถูกยกเลิกแล้ว');

      let roster = await this.repository.listSessionRoster(session.id, runner);
      if (created) {
        const rosterCount = await this.repository.insertRosterSnapshot(
          session.id,
          actor.classroomId,
          actor.actorUserId,
          runner,
        );
        if (rosterCount === 0)
          throw new BadRequestException('ห้องเรียนนี้ไม่มีนักเรียนที่ใช้งานได้');
        await this.repository.updateExpectedRosterCount(
          session.id,
          rosterCount,
          actor.actorUserId,
          runner,
        );
        session.expected_roster_count = rosterCount;
        roster = await this.repository.listSessionRoster(session.id, runner);
      }
      if (roster.length !== Number(session.expected_roster_count)) {
        throw new ConflictException('ข้อมูล roster snapshot ของรอบเช็กชื่อไม่ครบถ้วน');
      }
      const exceptions = await this.repository.listStoredExceptions(session.id, runner);
      return { session, exceptions, idempotent: !created };
    });
    return {
      success: true,
      data: this.toSessionResponse(result.session, result.exceptions, result.idempotent),
    };
  }

  private prepareExceptions(
    session: ExceptionAttendanceSessionRow,
    input: AttendanceExceptionDto[],
  ): PreparedAttendanceException[] {
    const studentIds = new Set<string>();
    const dayBounds = getBangkokDayBounds(session.attendance_date);
    const now = Date.now();
    return input.map((item) => {
      if (studentIds.has(item.studentId)) {
        throw new BadRequestException('นักเรียนหนึ่งคนมี exception ได้เพียงรายการเดียว');
      }
      studentIds.add(item.studentId);
      const statusCode = ATTENDANCE_STATUS_CODE[item.status];
      if (statusCode === 1) throw new BadRequestException('ไม่ต้องส่งสถานะมาเรียนเป็น exception');
      const suppliedReason = item.absenceReasonCode?.trim().toUpperCase() || null;
      if (statusCode !== 2 && suppliedReason) {
        throw new BadRequestException('สาเหตุการขาดใช้ได้เฉพาะสถานะขาด');
      }
      const candidate = item.markedAt ? new Date(item.markedAt) : new Date();
      const markedAt =
        Number.isFinite(candidate.getTime()) &&
        candidate >= dayBounds.start &&
        candidate <= dayBounds.end &&
        candidate.getTime() <= now + 5 * 60 * 1000
          ? candidate
          : new Date();
      return {
        ...item,
        statusCode: statusCode as 2 | 3 | 4,
        markedAt: markedAt.toISOString(),
        absenceReasonCode: statusCode === 2 ? (suppliedReason ?? 'UNKNOWN') : null,
      };
    });
  }

  private sameExceptions(
    current: StoredAttendanceExceptionRow[],
    requested: PreparedAttendanceException[],
  ): boolean {
    if (current.length !== requested.length) return false;
    const byStudent = new Map(
      current.map((item) => [
        item.student_uuid,
        {
          statusCode: Number(item.attendance_status_code),
          absenceReasonCode: item.absence_reason_code,
        },
      ]),
    );
    return requested.every((item) => {
      const stored = byStudent.get(item.studentId);
      return (
        stored?.statusCode === item.statusCode &&
        stored.absenceReasonCode === item.absenceReasonCode
      );
    });
  }

  private async assertActiveAbsenceReasons(
    requested: PreparedAttendanceException[],
  ): Promise<void> {
    const requestedCodes = new Set(
      requested
        .map((item) => item.absenceReasonCode)
        .filter((code): code is string => code !== null),
    );
    if (requestedCodes.size === 0) return;

    const activeCodes = new Set(
      (await this.masterData.listActiveOptions('absence-reasons')).map((option) => option.code),
    );
    if ([...requestedCodes].some((code) => !activeCodes.has(code))) {
      throw new BadRequestException('สาเหตุการขาดไม่ถูกต้องหรือถูกปิดใช้งาน');
    }
  }

  async submit(
    actor: ExceptionAttendanceActor,
    sessionId: string,
    dto: SubmitExceptionAttendanceDto,
  ) {
    const outcome = await this.repository.withTransaction(async (runner) => {
      const session = await this.repository.findSessionForUpdate(sessionId, runner);
      if (!session) throw new NotFoundException('ไม่พบรอบเช็กชื่อ');
      if (
        actor.schoolId !== Number(session.school_id) ||
        actor.classroomId !== Number(session.classroom_id)
      ) {
        throw new NotFoundException('ไม่พบรอบเช็กชื่อในขอบเขตของคุณ');
      }
      if (session.record_storage_mode !== 'EXCEPTIONS') {
        throw new ConflictException('รอบเช็กชื่อเดิมเป็นข้อมูลแบบอ่านอย่างเดียว');
      }
      if (session.status === 'VOIDED') throw new ConflictException('รอบเช็กชื่อนี้ถูกยกเลิกแล้ว');

      const prepared = this.prepareExceptions(session, dto.exceptions);
      const roster = await this.repository.listSessionRoster(session.id, runner);
      if (roster.length === 0 || roster.length !== Number(session.expected_roster_count)) {
        throw new ConflictException('ข้อมูล roster snapshot ของรอบเช็กชื่อไม่ครบถ้วน');
      }
      const rosterSet = new Set(roster);
      if (prepared.some((item) => !rosterSet.has(item.studentId))) {
        throw new BadRequestException('มีนักเรียนที่ไม่อยู่ใน roster snapshot ของรอบนี้');
      }
      const current = await this.repository.listStoredExceptions(session.id, runner);
      if (session.status === 'SUBMITTED') {
        if (!this.sameExceptions(current, prepared)) {
          throw new ConflictException('รอบเช็กชื่อนี้ส่งแล้วและข้อมูลไม่ตรงกับคำขอเดิม');
        }
        return {
          session,
          exceptions: current,
          roster,
          changed: false,
        };
      }
      if (session.status !== 'OPEN' && session.status !== 'REOPENED') {
        throw new ConflictException('สถานะรอบเช็กชื่อไม่อนุญาตให้ส่งข้อมูล');
      }

      await this.assertActiveAbsenceReasons(prepared);
      await this.repository.replaceExceptions(session.id, prepared, actor, runner);
      const submitted = await this.repository.finalizeSession(
        session,
        prepared.length,
        roster.length,
        actor,
        runner,
      );
      await this.audit.recordAtomic(
        {
          actorUserId: actor.actorUserId,
          actorLabel: actor.actorLabel,
          action: 'ATTENDANCE_SUBMIT',
          targetType: 'attendance_session',
          targetId: session.id,
          metadata: {
            schoolId: session.school_id,
            classroomId: Number(session.classroom_id),
            rosterCount: roster.length,
            exceptionCount: prepared.length,
            source: actor.source,
          },
          ip: null,
        },
        runner,
      );
      return {
        session: submitted,
        exceptions: prepared.map((item) => ({
          student_uuid: item.studentId,
          attendance_status_code: item.statusCode,
          absence_reason_code: item.absenceReasonCode,
        })),
        roster,
        changed: true,
      };
    });

    if (outcome.changed) {
      try {
        await this.riskProfiles.requestStudentRecalculation(
          outcome.roster,
          'exception-attendance-submit',
        );
      } catch {
        this.logger.warn(
          `Risk recalculation failed after attendance session ${outcome.session.id} for ${outcome.roster.length} student(s)`,
        );
      }
    }
    return {
      success: true,
      data: this.toSessionResponse(outcome.session, outcome.exceptions, !outcome.changed),
    };
  }
}
