import { Injectable, Logger } from '@nestjs/common';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { clean, generateToken, hashToken } from '../common/utils/helpers';
import { CreateTaskDto, type TaskDurationUnit } from './dto/task.dto';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';
import type { ActorContext } from './task.types';

@Injectable()
export class TaskLifecycleService {
  private readonly logger = new Logger(TaskLifecycleService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
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

  private normalizeDurationUnit(value: string | null | undefined): TaskDurationUnit {
    if (value === 'minutes' || value === 'hours' || value === 'days' || value === 'weeks') {
      return value;
    }

    return 'hours';
  }

  async createTask(actor: ActorContext | undefined, data: CreateTaskDto, baseUrl: string) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    const taskType = clean(data.task_type) || clean(data.type) || 'VISIT';
    const assignedName = clean(data.assigned_to_name);
    const assignedEmail = clean(data.assigned_to_email);

    if (!assignedName) {
      throw new Error('assigned_to_name is required');
    }
    if (taskType === 'LOGIN' && !assignedEmail) {
      throw new Error('assigned_to_email is required for LOGIN');
    }

    this.taskPolicyService.assertCanCreateTask(currentActor, taskType);

    const roleMap = taskType === 'LOGIN' ? await this.taskPolicyService.getRoleMap() : undefined;
    const loginRole = taskType === 'LOGIN' ? this.taskPolicyService.normalizeRole(data) : null;
    const loginPermissions =
      taskType === 'LOGIN'
        ? this.taskPolicyService.normalizePermissionList(data.permissions ?? data.mock_permissions)
        : [];
    const loginDataScope =
      taskType === 'LOGIN' ? this.taskPolicyService.normalizeScope(data.data_scope) : {};

    if (taskType === 'LOGIN') {
      await this.taskPolicyService.assertAssignableLoginPayload(
        currentActor,
        {
          ...data,
          role: loginRole,
          permissions: loginPermissions,
          data_scope: loginDataScope,
        },
        roleMap,
      );
    }

    const taskId = crypto.randomUUID();
    const token = generateToken();
    const tokenHash = hashToken(token);
    const linkId = crypto.randomUUID();

    const expiresValue = this.normalizeNumber(data.expires_value) || 24;
    const expiresUnit = this.normalizeDurationUnit(data.expires_unit);
    let expiresMs = expiresValue * 60 * 60 * 1000;

    if (expiresUnit === 'minutes') {
      expiresMs = expiresValue * 60 * 1000;
    } else if (expiresUnit === 'days') {
      expiresMs = expiresValue * 24 * 60 * 60 * 1000;
    } else if (expiresUnit === 'weeks') {
      expiresMs = expiresValue * 7 * 24 * 60 * 60 * 1000;
    }

    if (taskType === 'ATTENDANCE') {
      expiresMs = Math.max(expiresMs, 60 * 60 * 1000);
    }

    const expiresAt = new Date(Date.now() + expiresMs).toISOString();
    const magicLink = `${baseUrl}/#/task/${token}`;

    try {
      await this.taskRepository.withTransaction(async (executor) => {
        let caseId: number | null = null;

        if (taskType === 'VISIT') {
          const existingCaseId = this.normalizeNumber(data.existing_case_id);

          if (existingCaseId) {
            const existingCase = await this.taskRepository.findCaseById(existingCaseId, executor);
            if (!existingCase) {
              throw new Error('Case not found');
            }
            caseId = existingCaseId;
            await this.taskRepository.updateCaseStatus(caseId, 'IN_PROGRESS', executor);
          } else {
            const studentName = clean(data.student_name);
            if (!studentName) {
              throw new Error('student_name is required for Field Visit');
            }

            caseId = await this.taskRepository.createCase(
              {
                studentName,
                studentSchool: clean(data.student_school),
                studentAddress: clean(data.student_address),
                studentLat: this.normalizeNumber(data.student_lat),
                studentLng: this.normalizeNumber(data.student_lng),
                reasonFlagged: clean(data.reason_flagged),
                studentId: clean(data.student_id) || null,
              },
              executor,
            );

            await this.taskRepository.updateCaseStatus(caseId, 'IN_PROGRESS', executor);
          }
        }

        await this.taskRepository.createTask(
          {
            taskId,
            caseId,
            taskType,
            targetGrade: clean(data.target_grade) || null,
            targetRoom: clean(data.target_room) || null,
            targetSchoolId: this.normalizeNumber(data.target_school_id),
          },
          executor,
        );

        await this.taskRepository.createTaskLink(
          {
            linkId,
            taskId,
            parentLinkId: null,
            tokenHash,
            magicLink,
            delegationDepth: 0,
            assignedToName: assignedName,
            assignedToPhone: clean(data.assigned_to_phone),
            assignedToEmail: assignedEmail,
            expiresAt,
            subject: clean(data.subject),
            otpVerified: assignedEmail ? 0 : 1,
            createdByUserId: currentActor.virtual_login ? null : currentActor.id,
            loginRole,
            loginPermissions,
            loginDataScope,
          },
          executor,
        );
      });

      let qrDataUrl: string | null = null;
      try {
        qrDataUrl = await QRCode.toDataURL(magicLink, {
          width: 300,
          margin: 2,
        });
      } catch (err) {
        this.logger.warn('Failed to generate QR code', err);
      }

      return {
        task_id: taskId,
        magic_link: magicLink,
        qr_code_data: qrDataUrl,
        expires_at: expiresAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`createTask error: ${message}`);
      throw err;
    }
  }

  async deleteTask(taskId: string) {
    try {
      const result = await this.taskRepository.deleteTask(taskId);
      return { success: true, rowCount: result.rowCount ?? 0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`deleteTask error: ${message}`);
      throw err;
    }
  }
}
