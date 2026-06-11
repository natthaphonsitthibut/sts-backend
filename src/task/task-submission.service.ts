import { Injectable, Logger } from '@nestjs/common';
import { AutomationService } from '../automation/automation.service';
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
    const today = new Date().toISOString().split('T')[0];
    const attendanceRecords = Array.isArray(records) ? records : [];

    try {
      const task = await this.taskAccessService.getTaskByToken(token);
      const recorder =
        typeof task?.assigned_to_name === 'string' ? task.assigned_to_name : 'Teacher (Magic Link)';

      await this.taskRepository.withTransaction(async (executor) => {
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
    this.logger.log(`[saveTaskSubmission] token=${token}, data=${JSON.stringify(data)}`);

    try {
      const tokenHash = hashToken(token);
      const link = await this.taskRepository.findTaskSubmissionContextByTokenHash(tokenHash);

      if (!link) {
        throw new Error('Task not found');
      }

      await this.taskRepository.withTransaction(async (executor) => {
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
          await this.taskRepository.updateCaseAfterSubmission(
            {
              caseId: link.case_id,
              nextSummary,
              updatedStudentAddress: addressChanged ? (data.updated_student_address ?? null) : null,
              updatedLat:
                addressChanged && data.updated_student_address
                  ? (this.normalizeNumber(data.updated_lat) ?? this.normalizeNumber(data.visit_lat))
                  : null,
              updatedLng:
                addressChanged && data.updated_student_address
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
