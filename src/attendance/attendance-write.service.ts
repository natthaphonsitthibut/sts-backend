import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { resolveActorDataScope, type AuthenticatedRequestUser, type DataScope } from '../auth';
import { getBangkokDateString, getIsoDayOfWeekFromDateString } from '../common/utils/date.util';
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
      throw new BadRequestException('ไม่สามารถเช็คชื่อล่วงหน้าสำหรับวันที่ในอนาคตได้');
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
      ?.enqueueStudents(result.affectedStudentIds, 'attendance-save')
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to enqueue attendance risk profile recalculation: ${message}`);
      });
    let newCases: NewCase[] = [];

    if (triggerType === 'IMMEDIATE' && result.calendarConfigured) {
      this.logger.log('Attendance saved. Trigger Type is IMMEDIATE. Executing absence check...');
      newCases = await this.automationService.checkConsecutiveAbsences();
    }

    return {
      success: true,
      newCases,
      session: result.session,
      calendarConfigured: result.calendarConfigured,
    };
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
    const studentIds = normalizedRecords.map((record) => record.student_id);
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
      throw new BadRequestException('บันทึกเช็คชื่อได้ครั้งละหนึ่งห้องและหนึ่งภาคเรียน');
    }

    const rosterIds = await this.attendanceOperationsRepository.listRosterIds(first, executor);
    if (
      rosterIds.length !== studentIds.length ||
      rosterIds.some((studentId) => !uniqueIds.has(studentId))
    ) {
      throw new ConflictException('รายชื่อที่ส่งไม่ตรงกับ roster ปัจจุบัน กรุณาโหลดรายชื่อใหม่');
    }

    const attendanceDate = date ?? getBangkokDateString();
    const selectedSlot =
      timetableSlotId !== undefined
        ? await this.resolveDirectTimetableSlotSession(
            timetableSlotId,
            first,
            attendanceDate,
            executor,
          )
        : null;
    const sessionContext =
      context.session ??
      (selectedSlot
        ? {
            kind: 'SUBJECT' as const,
            period: selectedSlot.period,
            subjectId: selectedSlot.subject_id,
            timetableSlotId: Number(selectedSlot.id),
          }
        : { kind: 'DAILY' as const, period: 1 });
    const term = await this.attendanceOperationsRepository.findOrCreateTermForClass(
      first,
      context.actorUserId,
      executor,
    );
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
      throw new ConflictException('รอบเช็คชื่อนี้ถูกยกเลิกแล้ว');
    }

    const statusCodes = normalizedRecords.map((record) => ATTENDANCE_STATUS_CODE[record.status]);
    const previousStatuses =
      session.status === 'REOPENED' && sessionContext.kind === 'DAILY'
        ? await this.attendanceRepository.listAttendanceStatuses(
            studentIds,
            attendanceDate,
            sessionContext.period,
            executor,
          )
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
        date: attendanceDate,
        period: sessionContext.period,
        sessionKind: sessionContext.kind,
        recordedBy: context.recorder,
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
      studentIds.length,
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
      throw new BadRequestException('ไม่พบคาบเรียนที่จะเช็คชื่อ');
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
      };
    });
  }

  private isAttendanceSelectionStatus(status: string): status is AttendanceSelectionStatus {
    return status in ATTENDANCE_STATUS_CODE;
  }
}
