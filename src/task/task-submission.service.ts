import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AutomationService } from '../automation/automation.service';
import { getBangkokDateString } from '../common/utils/date.util';
import { hashToken } from '../common/utils/helpers';
import { SaveTaskSubmissionDto, TaskAttendanceRecordDto } from './dto/task.dto';
import { TaskAccessService } from './task-access.service';
import { TaskRepository } from './task.repository';

@Injectable()
export class TaskSubmissionService {
  private readonly logger = new Logger(TaskSubmissionService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskAccessService: TaskAccessService,
    private readonly automationService: AutomationService,
  ) {}

  private normalizeNumber(value: string | number | null | undefined): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private normalizeBoolean(value: boolean | string | number | null | undefined): boolean {
    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'number') {
      return value === 1;
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      return normalized === 'true' || normalized === '1' || normalized === 'yes';
    }

    return false;
  }

  /**
   * Validate a magic-link token's state before any write. The token is the
   * credential (no AuthGuard), so this is where we fail closed: reject missing,
   * expired, admin-locked, completed, or delegated links, and links whose type
   * does not match the write surface. Returns the validated link shape.
   */
  private validateUsableLink(
    task: Awaited<ReturnType<TaskAccessService['getTaskByToken']>>,
    expectedType: 'ATTENDANCE' | 'VISIT',
  ): Record<string, unknown> {
    if (!task) {
      throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
    }

    const link = task;

    if (link.error) {
      const status = typeof link.status === 'string' ? link.status : '';
      const message = typeof link.error === 'string' ? link.error : 'ลิงก์ใช้งานไม่ได้';
      if (status === 'EXPIRED') {
        throw new GoneException(message);
      }
      if (status === 'ADMIN_LOCKED') {
        throw new ForbiddenException(message);
      }
      if (status === 'COMPLETED' || status === 'DELEGATED') {
        throw new ConflictException(message);
      }
      throw new BadRequestException(message);
    }

    if (link.task_type !== expectedType) {
      throw new ForbiddenException('ลิงก์นี้ไม่รองรับการบันทึกประเภทนี้');
    }

    return link;
  }

  private toScalarString(value: unknown): string | null {
    if (typeof value === 'string') {
      return value.trim().length > 0 ? value : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
    return null;
  }

  private resolveAttendanceStatus(status: string | undefined): number {
    if (status === 'P_PRESENT') {
      return 1;
    }
    if (status === 'P_ABSENT') {
      return 2;
    }

    return 3;
  }

  async saveTaskAttendance(token: string, records: TaskAttendanceRecordDto[] | undefined) {
    const today = getBangkokDateString();
    const attendanceRecords = Array.isArray(records) ? records : [];

    try {
      const task = await this.taskAccessService.getTaskByToken(token);
      const link = this.validateUsableLink(task, 'ATTENDANCE');
      const recorder =
        typeof link.assigned_to_name === 'string' ? link.assigned_to_name : 'Teacher (Magic Link)';

      // Enforce the link's own scope: every record must belong to the task's
      // school (and grade/room when set). Reject any student outside that roster.
      const targetSchoolId =
        typeof link.target_school_id === 'number'
          ? link.target_school_id
          : Number(link.target_school_id);
      // School scope is the security floor: without it listTaskStudents would
      // return every student nationwide. Grade/room narrow it further when the
      // link carries them, but a school-wide attendance link is still valid.
      if (!Number.isInteger(targetSchoolId)) {
        throw new ConflictException('ลิงก์เช็คชื่อนี้ไม่มีขอบเขตโรงเรียน');
      }

      const roster = await this.taskRepository.listTaskStudents({
        targetGrade: this.toScalarString(link.target_grade),
        targetRoom: this.toScalarString(link.target_room),
        targetSchoolId,
      });
      const allowedStudentIds = new Set(roster.map((student) => String(student.id)));

      for (const record of attendanceRecords) {
        const studentId = typeof record.student_id === 'string' ? record.student_id : '';
        if (!studentId || !allowedStudentIds.has(studentId)) {
          throw new ForbiddenException('พบนักเรียนนอกขอบเขตของลิงก์นี้');
        }
      }

      await this.taskRepository.withTransaction(async (executor) => {
        const live = await this.taskRepository.lockLiveTaskLink(String(link.link_id), executor);
        if (!live) {
          throw new ConflictException('ลิงก์นี้ถูกลบแล้ว');
        }
        for (const record of attendanceRecords) {
          const studentId = typeof record.student_id === 'string' ? record.student_id : '';
          if (!studentId) {
            continue;
          }

          const student = await this.taskRepository.findStudentTermMetadata(studentId, executor);

          if (!student) {
            continue;
          }

          await this.taskRepository.replaceAttendanceRecord(
            {
              studentId,
              attendanceDate: today,
              attendanceStatus: this.resolveAttendanceStatus(record.status),
              recordedBy: recorder,
              schoolId: Number(student.SchoolID_Onec),
              gradeLevelId: Number(student.GradeLevelID_Onec),
              roomId: Number(student.RoomID_Onec),
              semester: Number(student.Semester_Onec),
              academicYear: Number(student.AcademicYear_Onec),
            },
            executor,
          );
        }
      });

      const triggerType = await this.taskRepository.getSystemSettingValue('ALERT_TRIGGER_TYPE');

      if (triggerType === 'IMMEDIATE') {
        this.logger.log(
          'Attendance saved via task link. Trigger Type is IMMEDIATE. Executing absence check...',
        );
        this.automationService.checkConsecutiveAbsences().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`Error executing immediate absence check from task: ${message}`);
        });
      }

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`saveTaskAttendance error: ${message}`);
      throw err;
    }
  }

  async saveTaskSubmission(token: string, data: SaveTaskSubmissionDto) {
    try {
      const task = await this.taskAccessService.getTaskByToken(token);
      this.validateUsableLink(task, 'VISIT');

      const tokenHash = hashToken(token);
      const link = await this.taskRepository.findTaskSubmissionContextByTokenHash(tokenHash);

      if (!link) {
        throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
      }

      await this.taskRepository.withTransaction(async (executor) => {
        const live = await this.taskRepository.lockLiveTaskLink(String(link.link_id), executor);
        if (!live) {
          throw new ConflictException('ลิงก์นี้ถูกลบแล้ว');
        }
        await this.taskRepository.insertTaskSubmission(
          {
            linkId: String(link.link_id),
            visitLat: this.normalizeNumber(data.visit_lat),
            visitLng: this.normalizeNumber(data.visit_lng),
            causeCategory: data.cause_category ?? null,
            causeDetail: data.notes ?? data.cause_detail ?? null,
            recommendation: data.recommendation ?? null,
            photoPaths: data.photo_paths ?? null,
            addressChanged: this.normalizeBoolean(data.address_changed),
            updatedStudentAddress: data.updated_student_address ?? null,
            updatedLat: this.normalizeNumber(data.updated_lat),
            updatedLng: this.normalizeNumber(data.updated_lng),
          },
          executor,
        );

        if (link.task_type === 'VISIT' && typeof link.case_id === 'number') {
          const nextSummary = data.notes || data.cause_detail || 'No notes provided';
          const addressChanged = this.normalizeBoolean(data.address_changed);
          // When the visitor flags the home location as wrong, persist the
          // corrected coordinates to the case independently of the address TEXT —
          // changing only the pin (no typed address) must still update the canonical
          // student_lat/lng. Address text updates only when actually provided.
          await this.taskRepository.updateCaseAfterSubmission(
            {
              caseId: link.case_id,
              nextSummary,
              // Trim to null so an empty/whitespace address does not wipe the
              // existing one via COALESCE (pin-only correction sends no address).
              updatedStudentAddress: addressChanged
                ? data.updated_student_address?.trim() || null
                : null,
              updatedLat: addressChanged
                ? (this.normalizeNumber(data.updated_lat) ?? this.normalizeNumber(data.visit_lat))
                : null,
              updatedLng: addressChanged
                ? (this.normalizeNumber(data.updated_lng) ?? this.normalizeNumber(data.visit_lng))
                : null,
            },
            executor,
          );
        }

        await this.taskRepository.updateTaskStatus(String(link.task_id), 'COMPLETED', executor);
        await this.taskRepository.updateTaskLinkStatus(String(link.link_id), 'COMPLETED', executor);
      });

      this.logger.log('[saveTaskSubmission] success');
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`saveTaskSubmission error: ${message}`);
      throw err;
    }
  }
}
