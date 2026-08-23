import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { resolveActorDataScope, type AuthenticatedRequestUser, type DataScope } from '../auth';
import {
  getBangkokDateString,
  getBangkokDayBounds,
  getIsoDayOfWeekFromDateString,
} from '../common/utils/date.util';
import { AutomationService, NewCase } from '../automation/automation.service';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceOperationsRepository } from './attendance-operations.repository';
import { ATTENDANCE_STATUS_CODE } from './attendance-status';
import type {
  AttendanceSaveRecordInput,
  AttendanceSelectionStatus,
  AttendanceWriteContext,
  AttendanceWriteRecord,
  QueryExecutor,
} from './attendance.types';

interface TimetableSlotSessionRow extends Record<string, unknown> {
  id: number | string;
  school_term_id: number | string;
  school_id: number;
  grade_level_id: number;
  room_no: number;
  day_of_week: number;
  period: number;
  subject_id: number;
}

@Injectable()
export class AttendanceWriteService {
  private readonly logger = new Logger(AttendanceWriteService.name);

  constructor(
    private readonly attendanceRepository: AttendanceRepository,
    private readonly attendanceOperationsRepository: AttendanceOperationsRepository,
    private readonly automationService: AutomationService,
    private readonly riskProfileService?: RiskProfileService,
  ) {}

  /**
   * Read-only calendar preflight for attendance entry points that do not have
   * an authenticated user scope (for example, a verified teacher access link).
   * The caller has already established classroom scope before reaching here.
   */
  async getCalendarAvailabilityForClassroom(input: {
    schoolId: number;
    gradeLabel: string;
    roomNo: number;
    date: string;
    timetableSlotId?: number;
  }): Promise<{ calendarConfigured: boolean; canRecord: boolean; dayType: string | null }> {
    const context = await this.attendanceOperationsRepository.findSessionContext(
      input.schoolId,
      input.gradeLabel,
      input.roomNo,
      input.date,
      input.timetableSlotId,
    );
    const calendarConfigured = context.term?.status === 'ACTIVE';
    const dayType = context.calendarDay?.day_type ?? null;
    return {
      calendarConfigured,
      canRecord: !calendarConfigured || dayType === 'SCHOOL_DAY',
      dayType,
    };
  }

  async saveAttendance(
    records: AttendanceSaveRecordInput[],
    actor?: AuthenticatedRequestUser,
    timetableSlotId?: number,
    date?: string,
  ) {
    const normalizedRecords = this.normalizeRecords(records);
    if (normalizedRecords.length === 0) {
      return { success: true, newCases: [] as NewCase[] };
    }

    if (date && date > getBangkokDateString()) {
      throw new BadRequestException('ไม่สามารถเช็กชื่อล่วงหน้าสำหรับวันที่ในอนาคตได้');
    }

    const result = await this.attendanceOperationsRepository.withTransaction(
      async (executor) =>
        await this.saveAttendanceWithinTransaction(
          normalizedRecords,
          {
            actorUserId: actor?.id ?? null,
            actorLabel: actor?.username || (actor?.id ? `user#${actor.id}` : 'unknown-user'),
            recorder: this.resolveRecorder(actor),
          },
          executor,
          resolveActorDataScope(actor),
          timetableSlotId,
          date,
        ),
    );

    const triggerType = await this.attendanceRepository.getAlertTriggerType();
    await this.riskProfileService
      ?.requestStudentRecalculation(result.affectedStudentIds, 'attendance-save')
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to enqueue attendance risk profile recalculation: ${message}`);
      });
    let newCases: NewCase[] = [];

    if (triggerType === 'IMMEDIATE' && result.calendarConfigured) {
      this.logger.log('Attendance saved. Trigger Type is IMMEDIATE. Executing absence check...');
      // Only this round's students can have moved, so the pass is scoped to them
      // instead of re-sweeping every enrolment while the teacher waits.
      newCases = await this.automationService.checkConsecutiveAbsences(result.affectedStudentIds);
    }

    return {
      success: true,
      newCases,
      session: result.session,
      calendarConfigured: result.calendarConfigured,
    };
  }

  /**
   * Everything both write paths need before touching rows: scope, class shape,
   * roster, term/calendar validity and the locked session. `requireFullRoster`
   * is the one difference — a final submit must carry the whole class, while a
   * draft autosave carries only what the teacher has tapped so far.
   */
  private async resolveWriteContext(
    studentIds: string[],
    context: AttendanceWriteContext,
    executor: QueryExecutor,
    options: { requireFullRoster: boolean },
    actorScope?: DataScope,
    timetableSlotId?: number,
    date?: string,
  ) {
    const uniqueIds = new Set(studentIds);
    if (uniqueIds.size !== studentIds.length) {
      throw new BadRequestException('พบรายชื่อนักเรียนซ้ำในคำขอ');
    }

    if (context.allowedStudentIds) {
      const allowed = new Set(context.allowedStudentIds);
      if (studentIds.some((studentId) => !allowed.has(studentId))) {
        throw new ForbiddenException('พบนักเรียนนอกขอบเขตที่ได้รับอนุญาต');
      }
    } else {
      const inScope = new Set(
        await this.attendanceRepository.filterStudentIdsInScope(studentIds, actorScope, executor),
      );
      if (studentIds.some((studentId) => !inScope.has(studentId))) {
        throw new ForbiddenException('พบนักเรียนนอกขอบเขตของคุณ');
      }
    }

    const metadataRows = await this.attendanceOperationsRepository.findClassMetadata(
      studentIds,
      executor,
    );
    if (metadataRows.length !== studentIds.length) {
      throw new BadRequestException('ไม่พบข้อมูลนักเรียนบางรายการใน roster ปัจจุบัน');
    }
    const first = metadataRows[0];
    const sameClass = metadataRows.every(
      (row) =>
        row.school_id === first.school_id &&
        row.grade_level_id === first.grade_level_id &&
        row.room_id === first.room_id &&
        row.academic_year === first.academic_year &&
        row.semester === first.semester,
    );
    if (!sameClass) {
      throw new BadRequestException('บันทึกเช็กชื่อได้ครั้งละหนึ่งห้องและหนึ่งภาคเรียน');
    }

    const rosterIds = await this.attendanceOperationsRepository.listRosterIds(first, executor);
    if (options.requireFullRoster) {
      if (
        rosterIds.length !== studentIds.length ||
        rosterIds.some((studentId) => !uniqueIds.has(studentId))
      ) {
        throw new ConflictException('รายชื่อที่ส่งไม่ตรงกับ roster ปัจจุบัน กรุณาโหลดรายชื่อใหม่');
      }
    } else {
      // A draft may cover part of the class, but never anyone outside it.
      const roster = new Set(rosterIds);
      if (studentIds.some((studentId) => !roster.has(studentId))) {
        throw new ForbiddenException('พบนักเรียนที่ไม่อยู่ใน roster ของห้องนี้');
      }
    }

    const attendanceDate = date ?? getBangkokDateString();
    if (timetableSlotId === undefined && !context.session) {
      throw new BadRequestException('กรุณาเลือกคาบรายวิชาก่อนเช็กชื่อ');
    }
    const selectedSlot =
      timetableSlotId === undefined
        ? null
        : await this.resolveDirectTimetableSlotSession(
            timetableSlotId,
            first,
            attendanceDate,
            executor,
          );
    let sessionContext = context.session;
    if (!sessionContext) {
      if (!selectedSlot) {
        throw new BadRequestException('กรุณาเลือกคาบรายวิชาก่อนเช็กชื่อ');
      }
      sessionContext = {
        kind: 'SUBJECT',
        period: selectedSlot.period,
        subjectId: selectedSlot.subject_id,
        timetableSlotId: Number(selectedSlot.id),
      };
    }
    const classroomSubjectId = await this.resolveClassroomSubjectId(
      first.classroom_id,
      sessionContext.subjectId,
      executor,
    );
    // Drafts fire many times per class, so they read the term without the
    // FOR UPDATE lock that find-or-create takes; only the rare first write of a
    // term falls through to the locking path.
    const term = options.requireFullRoster
      ? await this.attendanceOperationsRepository.findOrCreateTermForClass(
          first,
          context.actorUserId,
          executor,
        )
      : ((await this.attendanceOperationsRepository.findTermForClass(first, executor)) ??
        (await this.attendanceOperationsRepository.findOrCreateTermForClass(
          first,
          context.actorUserId,
          executor,
        )));
    if (selectedSlot && String(selectedSlot.school_term_id) !== String(term.id)) {
      throw new BadRequestException('คาบเรียนนี้ไม่อยู่ในภาคเรียนปัจจุบันของห้อง');
    }
    const calendarConfigured = term.status === 'ACTIVE';
    if (calendarConfigured) {
      if (
        !term.starts_on ||
        !term.ends_on ||
        attendanceDate < term.starts_on ||
        attendanceDate > term.ends_on
      ) {
        throw new ConflictException('วันที่เลือกอยู่นอกช่วงภาคเรียนที่เปิดใช้งาน');
      }
      const calendarDay = await this.attendanceOperationsRepository.findCalendarDay(
        term.id,
        attendanceDate,
        executor,
      );
      if (!calendarDay) {
        throw new ConflictException('ปฏิทินภาคเรียนไม่มีข้อมูลสำหรับวันที่เลือก');
      }
      if (calendarDay.day_type !== 'SCHOOL_DAY') {
        throw new ConflictException('วันที่เลือกไม่ใช่วันเรียนตามปฏิทินโรงเรียน');
      }
    }

    const session = await this.attendanceOperationsRepository.findOrCreateSessionForUpdate(
      {
        schoolTermId: term.id,
        schoolId: first.school_id,
        classroomId: first.classroom_id,
        classroomSubjectId,
        gradeLevelId: first.grade_level_id,
        roomId: first.room_id,
        attendanceDate,
        period: sessionContext.period,
        sessionKind: sessionContext.kind,
        subjectId: sessionContext.subjectId ?? null,
        timetableSlotId: sessionContext.timetableSlotId ?? null,
      },
      rosterIds.length,
      context.actorUserId,
      executor,
    );
    if (session.status === 'SUBMITTED') {
      throw new ConflictException('รอบนี้ส่งแล้ว กรุณาเปิดแก้ไขพร้อมระบุเหตุผลก่อน');
    }
    if (session.status === 'VOIDED') {
      throw new ConflictException('รอบเช็กชื่อนี้ถูกยกเลิกแล้ว');
    }

    return {
      studentIds,
      metadata: first,
      rosterIds,
      attendanceDate,
      sessionContext,
      calendarConfigured,
      session,
    };
  }

  async saveDraftMarks(
    records: AttendanceSaveRecordInput[],
    actor?: AuthenticatedRequestUser,
    timetableSlotId?: number,
    date?: string,
    clearedStudentIds: string[] = [],
  ) {
    if (date && date > getBangkokDateString()) {
      throw new BadRequestException('ไม่สามารถเช็กชื่อล่วงหน้าสำหรับวันที่ในอนาคตได้');
    }

    return await this.attendanceOperationsRepository.withTransaction(
      async (executor) =>
        await this.saveDraftMarksWithinTransaction(
          records,
          {
            actorUserId: actor?.id ?? null,
            actorLabel: actor?.username || (actor?.id ? `user#${actor.id}` : 'unknown-user'),
            recorder: this.resolveRecorder(actor),
          },
          executor,
          resolveActorDataScope(actor),
          timetableSlotId,
          date,
          clearedStudentIds,
        ),
    );
  }

  async saveAttendanceWithinTransaction(
    records: AttendanceSaveRecordInput[] | AttendanceWriteRecord[],
    context: AttendanceWriteContext,
    executor: QueryExecutor,
    actorScope?: DataScope,
    timetableSlotId?: number,
    date?: string,
  ): Promise<{
    session: { id: string; status: string; revision: number };
    calendarConfigured: boolean;
    affectedStudentIds: string[];
  }> {
    const normalizedRecords = this.normalizeRecords(records);
    const {
      studentIds,
      metadata: first,
      rosterIds,
      attendanceDate,
      sessionContext,
      calendarConfigured,
      session,
    } = await this.resolveWriteContext(
      normalizedRecords.map((record) => record.student_id),
      context,
      executor,
      { requireFullRoster: true },
      actorScope,
      timetableSlotId,
      date,
    );

    const statusCodes = normalizedRecords.map((record) => ATTENDANCE_STATUS_CODE[record.status]);
    const previousStatuses =
      session.status === 'REOPENED'
        ? ((await this.attendanceOperationsRepository.findReopenBaseline(
            session.id,
            session.revision,
            executor,
          )) ??
          (await this.attendanceOperationsRepository.listSessionAttendanceStatuses(
            session.id,
            executor,
          )))
        : [];
    const previousStatusByStudent = new Map(
      previousStatuses.map((row) => [row.student_uuid, row.attendance_status] as const),
    );
    const correctionChanges =
      session.status === 'REOPENED'
        ? studentIds.flatMap((studentUuid, index) => {
            const previousStatusCode = previousStatusByStudent.get(studentUuid) ?? null;
            const nextStatusCode = statusCodes[index];
            return previousStatusCode === nextStatusCode
              ? []
              : [{ studentUuid, previousStatusCode, nextStatusCode }];
          })
        : [];

    await this.attendanceRepository.upsertAttendanceBatch(
      {
        studentIds,
        statusCodes,
        markedAt: normalizedRecords.map((record) =>
          this.clampMarkedAt(record.marked_at, attendanceDate),
        ),
        date: attendanceDate,
        period: sessionContext.period,
        sessionKind: sessionContext.kind,
        recordedBy: context.recorder,
        recordedByTeacherId: context.recorderTeacherId ?? null,
        sessionId: session.id,
        metadata: {
          SchoolID_Onec: first.school_id,
          GradeLevelID_Onec: first.grade_level_id,
          RoomID_Onec: first.room_id,
          AcademicYear_Onec: first.academic_year,
          Semester_Onec: first.semester,
        },
      },
      executor,
    );
    await this.attendanceOperationsRepository.updateSessionSubmitted(
      session.id,
      context.actorUserId,
      executor,
    );
    await this.attendanceOperationsRepository.recordSessionAudit(
      {
        action: 'ATTENDANCE_SUBMIT',
        sessionId: session.id,
        actorUserId: context.actorUserId,
        actorLabel: context.actorLabel,
        metadata: {
          schoolId: first.school_id,
          gradeLevelId: first.grade_level_id,
          roomId: first.room_id,
          attendanceDate,
          sessionKind: sessionContext.kind,
          period: sessionContext.period,
          subjectId: sessionContext.subjectId ?? null,
          timetableSlotId: sessionContext.timetableSlotId ?? null,
          expectedRosterCount: rosterIds.length,
          recordedCount: studentIds.length,
          revision: session.revision,
          correctionReason: session.correction_reason,
          correctionChanges,
        },
      },
      executor,
    );

    return {
      session: { id: session.id, status: 'SUBMITTED', revision: session.revision },
      calendarConfigured,
      affectedStudentIds: studentIds,
    };
  }

  /**
   * Autosave for a check-in in progress. Writes only the students the teacher
   * has actually marked and deliberately stops there: the session stays OPEN,
   * no submit audit row is written, and neither risk recalculation nor the
   * absence automation fires. Those are side effects of *finishing* a class,
   * and firing them on every keystroke would mean an audit row and a full
   * absence scan per tap. `saveAttendance` remains the one place a round closes.
   */
  async saveDraftMarksWithinTransaction(
    records: AttendanceSaveRecordInput[] | AttendanceWriteRecord[],
    context: AttendanceWriteContext,
    executor: QueryExecutor,
    actorScope?: DataScope,
    timetableSlotId?: number,
    date?: string,
    clearedStudentIds: string[] = [],
  ): Promise<{
    session: { id: string; status: string; revision: number };
    expectedRosterCount: number;
    recordedCount: number;
  }> {
    const normalizedRecords = this.normalizeRecords(records);
    const cleared = clearedStudentIds.map((studentId) => studentId.trim()).filter(Boolean);
    if (normalizedRecords.length === 0 && cleared.length === 0) {
      throw new BadRequestException('กรุณาส่งสถานะอย่างน้อยหนึ่งรายการ');
    }

    const markedIds = normalizedRecords.map((record) => record.student_id);
    // Both sets go through the same scope/roster/class checks; only the writes
    // differ, so a caller cannot clear a student it may not also mark.
    const { metadata, rosterIds, attendanceDate, sessionContext, session } =
      await this.resolveWriteContext(
        [...markedIds, ...cleared],
        context,
        executor,
        { requireFullRoster: false },
        actorScope,
        timetableSlotId,
        date,
      );

    await this.attendanceRepository.deleteAttendanceMarks(
      { sessionId: session.id, studentIds: cleared },
      executor,
    );
    if (normalizedRecords.length > 0) {
      await this.attendanceRepository.upsertAttendanceBatch(
        {
          studentIds: markedIds,
          statusCodes: normalizedRecords.map((record) => ATTENDANCE_STATUS_CODE[record.status]),
          markedAt: normalizedRecords.map((record) =>
            this.clampMarkedAt(record.marked_at, attendanceDate),
          ),
          date: attendanceDate,
          period: sessionContext.period,
          sessionKind: sessionContext.kind,
          recordedBy: context.recorder,
          recordedByTeacherId: context.recorderTeacherId ?? null,
          sessionId: session.id,
          metadata: {
            SchoolID_Onec: metadata.school_id,
            GradeLevelID_Onec: metadata.grade_level_id,
            RoomID_Onec: metadata.room_id,
            AcademicYear_Onec: metadata.academic_year,
            Semester_Onec: metadata.semester,
          },
        },
        executor,
      );
    }
    const recordedCount = await this.attendanceOperationsRepository.updateSessionDraftProgress(
      session.id,
      context.actorUserId,
      executor,
    );

    return {
      session: { id: session.id, status: session.status, revision: session.revision },
      expectedRosterCount: rosterIds.length,
      recordedCount,
    };
  }

  async saveAttendanceGroupsWithinTransaction(
    records: AttendanceSaveRecordInput[],
    context: AttendanceWriteContext,
    executor: QueryExecutor,
  ): Promise<Array<{ calendarConfigured: boolean; affectedStudentIds: string[] }>> {
    const normalizedRecords = this.normalizeRecords(records);
    const studentIds = normalizedRecords.map((record) => record.student_id);
    const metadataRows = await this.attendanceOperationsRepository.findClassMetadata(
      studentIds,
      executor,
    );
    if (metadataRows.length !== studentIds.length) {
      throw new BadRequestException('ไม่พบข้อมูลนักเรียนบางรายการใน roster ปัจจุบัน');
    }
    const metadataByStudent = new Map(metadataRows.map((row) => [row.student_uuid, row] as const));
    const groups = new Map<string, AttendanceSaveRecordInput[]>();
    for (const record of normalizedRecords) {
      const metadata = metadataByStudent.get(record.student_id);
      if (!metadata) throw new BadRequestException('ไม่พบข้อมูลนักเรียนใน roster ปัจจุบัน');
      const key = [
        metadata.school_id,
        metadata.academic_year,
        metadata.semester,
        metadata.grade_level_id,
        metadata.room_id,
      ].join(':');
      const group = groups.get(key) ?? [];
      group.push(record);
      groups.set(key, group);
    }

    const results: Array<{ calendarConfigured: boolean; affectedStudentIds: string[] }> = [];
    for (const group of groups.values()) {
      results.push(
        await this.saveAttendanceWithinTransaction(
          group,
          { ...context, allowedStudentIds: group.map((record) => record.student_id) },
          executor,
        ),
      );
    }
    return results;
  }

  private resolveRecorder(actor?: AuthenticatedRequestUser): string {
    if (actor?.username && actor.username.trim().length > 0) {
      return actor.username;
    }
    if (typeof actor?.id === 'number') {
      return `user#${actor.id}`;
    }
    return 'Unknown';
  }

  private async resolveDirectTimetableSlotSession(
    timetableSlotId: number,
    metadata: {
      school_id: number;
      grade_level_id: number;
      room_id: number;
    },
    attendanceDate: string,
    executor: QueryExecutor,
  ): Promise<TimetableSlotSessionRow> {
    const result = await executor.query<TimetableSlotSessionRow>(
      `
        SELECT
          id,
          school_term_id,
          school_id,
          grade_level_id,
          room_no,
          day_of_week,
          period,
          subject_id
        FROM timetable_slots
        WHERE id = $1 AND deleted_at IS NULL
      `,
      [timetableSlotId],
    );
    const slot = result.rows[0];
    if (!slot) {
      throw new BadRequestException('ไม่พบคาบเรียนที่จะเช็กชื่อ');
    }

    if (
      Number(slot.school_id) !== Number(metadata.school_id) ||
      Number(slot.grade_level_id) !== Number(metadata.grade_level_id) ||
      Number(slot.room_no) !== Number(metadata.room_id)
    ) {
      throw new BadRequestException('คาบเรียนนี้ไม่อยู่ในห้องที่เลือก');
    }

    if (Number(slot.day_of_week) !== getIsoDayOfWeekFromDateString(attendanceDate)) {
      throw new BadRequestException('คาบเรียนนี้ไม่ตรงกับวันที่เลือก');
    }

    return slot;
  }

  private async resolveClassroomSubjectId(
    classroomId: number,
    subjectId: number | null | undefined,
    executor: QueryExecutor,
  ): Promise<number> {
    if (!subjectId) {
      throw new BadRequestException('ไม่พบรายวิชาที่จะเช็กชื่อ');
    }
    const result = await executor.query<{ id: number | string }>(
      `
        SELECT offering.id
        FROM classroom_subjects offering
        JOIN school_subjects catalog
          ON catalog.id = offering.school_subject_id
         AND catalog.school_id = offering.school_id
        WHERE offering.classroom_id = $1
          AND catalog.subject_id = $2
          AND offering.offering_status = 'ACTIVE'
          AND offering.deleted_at IS NULL
          AND catalog.subject_status = 'ACTIVE'
          AND catalog.deleted_at IS NULL
        LIMIT 1
      `,
      [classroomId, subjectId],
    );
    const classroomSubjectId = Number(result.rows[0]?.id);
    if (!Number.isInteger(classroomSubjectId)) {
      throw new BadRequestException('รายวิชานี้ไม่ได้เปิดสอนในห้องที่เลือก');
    }
    return classroomSubjectId;
  }

  private normalizeRecords(
    records: AttendanceSaveRecordInput[] | AttendanceWriteRecord[],
  ): AttendanceWriteRecord[] {
    if (!Array.isArray(records)) {
      throw new BadRequestException('Invalid records');
    }

    return records.map((record) => {
      const studentId = typeof record.student_id === 'string' ? record.student_id.trim() : '';
      const status =
        typeof record.status === 'string'
          ? (record.status.trim() as AttendanceSelectionStatus)
          : '';

      if (!studentId) {
        throw new BadRequestException('student_id is required');
      }

      if (!this.isAttendanceSelectionStatus(status)) {
        throw new BadRequestException('Invalid attendance status');
      }

      return {
        student_id: studentId,
        status,
        marked_at: typeof record.marked_at === 'string' ? record.marked_at : null,
      };
    });
  }

  /**
   * `marked_at` comes from the teacher's device, so it is never trusted as-is:
   * a wrong device clock would otherwise write a mark hours outside the class.
   * The value is clamped into the attendance day (and never into the future)
   * rather than rejected — failing the whole save over a skewed clock would
   * block check-in entirely, which is far worse than a few minutes of drift.
   * `"RecordedAt"` stays server-generated, so the true write time survives.
   */
  private clampMarkedAt(rawMarkedAt: string | null, attendanceDate: string): string | null {
    if (!rawMarkedAt) {
      return null;
    }

    const marked = new Date(rawMarkedAt);
    if (Number.isNaN(marked.getTime())) {
      this.logger.warn(`Discarding unparsable attendance marked_at: ${rawMarkedAt}`);
      return null;
    }

    const { start, end } = getBangkokDayBounds(attendanceDate);
    const upper = new Date(Math.min(end.getTime(), Date.now()));
    // A back-dated check-in has an upper bound in the past; keep the day's start
    // as the floor so the clamp range can never invert.
    const ceiling = upper.getTime() < start.getTime() ? start : upper;

    if (marked < start) {
      this.logger.warn(
        `Clamping attendance marked_at ${marked.toISOString()} up to ${start.toISOString()} (before ${attendanceDate})`,
      );
      return start.toISOString();
    }
    if (marked > ceiling) {
      this.logger.warn(
        `Clamping attendance marked_at ${marked.toISOString()} down to ${ceiling.toISOString()} (after ${attendanceDate} or in the future)`,
      );
      return ceiling.toISOString();
    }
    return marked.toISOString();
  }

  private isAttendanceSelectionStatus(status: string): status is AttendanceSelectionStatus {
    return status in ATTENDANCE_STATUS_CODE;
  }
}
