import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { resolveActorDataScope, type AuthenticatedRequestUser, type DataScope } from '../auth';
import { getBangkokDateString } from '../common/utils/date.util';
import { AutomationService, NewCase } from '../automation/automation.service';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { AttendanceRepository } from './attendance.repository';
import { AttendanceOperationsRepository } from './attendance-operations.repository';
import type {
  AttendanceSaveRecordInput,
  AttendanceSelectionStatus,
  AttendanceWriteContext,
  AttendanceWriteRecord,
  QueryExecutor,
} from './attendance.types';

const STATUS_CODE_MAP: Record<AttendanceSelectionStatus, number> = {
  P_PRESENT: 1,
  P_ABSENT: 2,
  P_LATE: 3,
};

@Injectable()
export class AttendanceWriteService {
  private readonly logger = new Logger(AttendanceWriteService.name);

  constructor(
    private readonly attendanceRepository: AttendanceRepository,
    private readonly attendanceOperationsRepository: AttendanceOperationsRepository,
    private readonly automationService: AutomationService,
    private readonly riskProfileService?: RiskProfileService,
  ) {}

  async saveAttendance(records: AttendanceSaveRecordInput[], actor?: AuthenticatedRequestUser) {
    const normalizedRecords = this.normalizeRecords(records);
    if (normalizedRecords.length === 0) {
      return { success: true, newCases: [] as NewCase[] };
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

    const today = getBangkokDateString();
    const sessionContext = context.session ?? { kind: 'DAILY' as const, period: 1 };
    const term = await this.attendanceOperationsRepository.findOrCreateTermForClass(
      first,
      context.actorUserId,
      executor,
    );
    const calendarConfigured = term.status === 'ACTIVE';
    if (calendarConfigured) {
      if (!term.starts_on || !term.ends_on || today < term.starts_on || today > term.ends_on) {
        throw new ConflictException('วันนี้อยู่นอกช่วงภาคเรียนที่เปิดใช้งาน');
      }
      const calendarDay = await this.attendanceOperationsRepository.findCalendarDay(
        term.id,
        today,
        executor,
      );
      if (!calendarDay) {
        throw new ConflictException('ปฏิทินภาคเรียนไม่มีข้อมูลสำหรับวันนี้');
      }
      if (calendarDay.day_type !== 'SCHOOL_DAY') {
        throw new ConflictException('วันนี้ไม่ใช่วันเรียนตามปฏิทินโรงเรียน');
      }
    }

    const session = await this.attendanceOperationsRepository.findOrCreateSessionForUpdate(
      {
        schoolTermId: term.id,
        schoolId: first.school_id,
        gradeLevelId: first.grade_level_id,
        roomId: first.room_id,
        attendanceDate: today,
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

    const statusCodes = normalizedRecords.map((record) => STATUS_CODE_MAP[record.status]);
    const previousStatuses =
      session.status === 'REOPENED' && sessionContext.kind === 'DAILY'
        ? await this.attendanceRepository.listAttendanceStatuses(
            studentIds,
            today,
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
        date: today,
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
          attendanceDate: today,
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
    return status in STATUS_CODE_MAP;
  }
}
