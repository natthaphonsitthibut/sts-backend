import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { normalizeDataScope, type AuthenticatedRequestUser } from '../auth';
import { getBangkokDateString } from '../common/utils/date.util';
import { AutomationService, NewCase } from '../automation/automation.service';
import { AttendanceRepository } from './attendance.repository';
import type {
  AttendanceSaveRecordInput,
  AttendanceSelectionStatus,
  AttendanceWriteRecord,
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
    private readonly automationService: AutomationService,
  ) {}

  async saveAttendance(records: AttendanceSaveRecordInput[], actor?: AuthenticatedRequestUser) {
    const normalizedRecords = this.normalizeRecords(records);
    if (normalizedRecords.length === 0) {
      return { success: true, newCases: [] as NewCase[] };
    }

    // Translate-at-entry: incoming student_id values are student_uuid (opaque).
    // Resolve all uuids → PersonID in one batch query before any downstream logic.
    // Fail closed: any uuid that doesn't resolve is treated identically to
    // out-of-scope — we never reveal whether it exists.
    const incomingUuids = normalizedRecords.map((record) => record.student_id);
    const uuidToPersonId =
      await this.attendanceRepository.getPersonIdsByStudentUuids(incomingUuids);
    for (const uuid of incomingUuids) {
      if (!uuidToPersonId.has(uuid)) {
        throw new ForbiddenException('พบนักเรียนนอกขอบเขตของคุณ');
      }
    }
    // Swap student_id from uuid to PersonID so all downstream logic is unchanged.
    for (const record of normalizedRecords) {
      record.student_id = uuidToPersonId.get(record.student_id)!;
    }

    const today = getBangkokDateString();
    const studentIds = normalizedRecords.map((record) => record.student_id);

    // Enforce the actor's data scope on the write: every student must be within
    // the actor's school/area/grade/room (empty scope = global admin = all).
    // Reject the whole batch if any student is out of scope (fail closed).
    const scope = normalizeDataScope(actor?.data_scope);
    const inScopeIds = new Set(
      await this.attendanceRepository.filterStudentIdsInScope(studentIds, scope),
    );
    for (const studentId of studentIds) {
      if (!inScopeIds.has(studentId)) {
        throw new ForbiddenException('พบนักเรียนนอกขอบเขตของคุณ');
      }
    }

    // Attribute the write to the real actor instead of a hardcoded "Admin".
    const recordedBy = this.resolveRecorder(actor);

    await this.attendanceRepository.withTransaction(async (executor) => {
      await this.attendanceRepository.deleteAttendanceBatchForDate(today, studentIds, executor);

      for (const record of normalizedRecords) {
        const metadata = await this.attendanceRepository.findStudentAttendanceMetadata(
          record.student_id,
          executor,
        );

        if (!metadata) {
          continue;
        }

        const studentUuid = await this.attendanceRepository.getStudentUuidByPersonId(
          record.student_id,
          executor,
        );

        await this.attendanceRepository.insertAttendanceRecord(
          {
            studentId: record.student_id,
            studentUuid: studentUuid!,
            date: today,
            statusCode: STATUS_CODE_MAP[record.status],
            recordedBy,
            period: 1,
            metadata,
          },
          executor,
        );
      }
    });

    const triggerType = await this.attendanceRepository.getAlertTriggerType();
    let newCases: NewCase[] = [];

    if (triggerType === 'IMMEDIATE') {
      this.logger.log('Attendance saved. Trigger Type is IMMEDIATE. Executing absence check...');
      newCases = await this.automationService.checkConsecutiveAbsences();
    }

    return { success: true, newCases };
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

  private normalizeRecords(records: AttendanceSaveRecordInput[]): AttendanceWriteRecord[] {
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
