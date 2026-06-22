import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { clean, generateToken, hashToken } from '../common/utils/helpers';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { CreateTaskDto, type TaskDurationUnit } from './dto/task.dto';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';
import type { ActorContext, DataScope, QueryExecutor, QueryResultRow } from './task.types';

@Injectable()
export class TaskLifecycleService {
  private readonly logger = new Logger(TaskLifecycleService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
    private readonly auditLog: AuditLogService,
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

  private getSingleActorSchoolId(actor: ActorContext): number | null {
    const scope = this.taskPolicyService.normalizeScope(actor.data_scope);
    if (scope.school_ids.length !== 1) {
      return null;
    }

    return this.normalizeNumber(scope.school_ids[0]);
  }

  private buildSchoolScope(school: QueryResultRow): DataScope {
    const schoolId = this.normalizeNumber(school.id as string | number | null | undefined);
    const scope: DataScope = {};

    if (typeof school.province === 'string' && school.province.trim().length > 0) {
      scope.provinces = [school.province.trim()];
    }
    if (typeof school.district === 'string' && school.district.trim().length > 0) {
      scope.districts = [school.district.trim()];
    }
    if (typeof school.sub_district === 'string' && school.sub_district.trim().length > 0) {
      scope.sub_districts = [school.sub_district.trim()];
    }
    if (schoolId !== null) {
      scope.school_ids = [schoolId];
    }

    return scope;
  }

  private async assertSchoolWithinActorScope(
    actor: ActorContext,
    schoolId: number,
    executor: QueryExecutor,
  ): Promise<void> {
    const school = await this.taskRepository.findSchoolById(schoolId, executor);
    if (!school) {
      throw new Error('School not found');
    }

    if (
      !this.taskPolicyService.isScopeSubsetOfActor(this.buildSchoolScope(school), actor.data_scope)
    ) {
      throw new ForbiddenException('ไม่มีสิทธิ์เข้าถึงโรงเรียนนี้');
    }
  }

  private async resolveCaseSchoolId(
    actor: ActorContext,
    studentUuid: string | null,
    targetSchoolId: number | null,
    executor: QueryExecutor,
  ): Promise<number | null> {
    if (studentUuid) {
      const studentMetadata = await this.taskRepository.findStudentTermMetadata(
        studentUuid,
        executor,
      );
      const studentSchoolId = this.normalizeNumber(
        studentMetadata?.SchoolID_Onec as string | number | null | undefined,
      );
      if (studentSchoolId !== null) {
        if (targetSchoolId !== null && targetSchoolId !== studentSchoolId) {
          throw new Error('target_school_id does not match student school');
        }
        await this.assertSchoolWithinActorScope(actor, studentSchoolId, executor);
        return studentSchoolId;
      }
    }

    if (targetSchoolId !== null) {
      await this.assertSchoolWithinActorScope(actor, targetSchoolId, executor);
      return targetSchoolId;
    }

    const actorSchoolId = this.getSingleActorSchoolId(actor);
    if (actorSchoolId !== null) {
      await this.assertSchoolWithinActorScope(actor, actorSchoolId, executor);
      return actorSchoolId;
    }

    return null;
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
    const magicLink = `${baseUrl}/task/${token}`;

    try {
      await this.taskRepository.withTransaction(async (executor) => {
        let caseId: number | null = null;
        const inputTargetSchoolId = this.normalizeNumber(data.target_school_id);
        let resolvedTargetSchoolId = inputTargetSchoolId;

        if (inputTargetSchoolId !== null) {
          await this.assertSchoolWithinActorScope(currentActor, inputTargetSchoolId, executor);
        } else if (taskType !== 'LOGIN') {
          resolvedTargetSchoolId = this.getSingleActorSchoolId(currentActor);
        }

        if (taskType === 'VISIT') {
          const existingCaseId = this.normalizeNumber(data.existing_case_id);

          if (existingCaseId) {
            const existingCase = await this.taskRepository.findCaseById(
              existingCaseId,
              executor,
              currentActor,
            );
            if (!existingCase) {
              throw new Error('Case not found');
            }
            const existingCaseSchoolId = this.normalizeNumber(
              existingCase.school_id as string | number | null | undefined,
            );
            if (
              existingCaseSchoolId !== null &&
              resolvedTargetSchoolId !== null &&
              existingCaseSchoolId !== resolvedTargetSchoolId
            ) {
              throw new Error('target_school_id does not match case school');
            }
            resolvedTargetSchoolId = resolvedTargetSchoolId ?? existingCaseSchoolId;
            caseId = existingCaseId;
            await this.taskRepository.updateCaseStatus(
              caseId,
              'IN_PROGRESS',
              executor,
              currentActor,
            );
          } else {
            const studentName = clean(data.student_name);
            const studentUuid = clean(data.student_id) || null;
            if (!studentName) {
              throw new Error('student_name is required for Field Visit');
            }

            const caseSchoolId = await this.resolveCaseSchoolId(
              currentActor,
              studentUuid,
              resolvedTargetSchoolId,
              executor,
            );
            resolvedTargetSchoolId = resolvedTargetSchoolId ?? caseSchoolId;

            caseId = await this.taskRepository.createCase(
              {
                studentName,
                studentSchool: clean(data.student_school),
                studentAddress: clean(data.student_address),
                studentLat: this.normalizeNumber(data.student_lat),
                studentLng: this.normalizeNumber(data.student_lng),
                reasonFlagged: clean(data.reason_flagged),
                studentUuid,
                schoolId: caseSchoolId,
                createdBy: resolveAuditActorId(currentActor),
              },
              executor,
            );

            await this.taskRepository.updateCaseStatus(
              caseId,
              'IN_PROGRESS',
              executor,
              currentActor,
            );
          }
        }

        await this.taskRepository.createTask(
          {
            taskId,
            caseId,
            taskType,
            targetGrade: clean(data.target_grade) || null,
            targetRoom: clean(data.target_room) || null,
            targetSchoolId: resolvedTargetSchoolId,
            createdBy: resolveAuditActorId(currentActor),
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
            // Email-assigned links require OTP (start unverified); links with no
            // email can't be OTP'd, so mark them pre-verified to skip the gate.
            otpVerified: assignedEmail ? 0 : 1,
            createdBy: resolveAuditActorId(currentActor),
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

  async deleteTask(taskId: string, actor?: ActorContext, ip?: string | null) {
    try {
      const actorId = resolveAuditActorId(actor);
      const result = await this.taskRepository.deleteTask(taskId, actorId);
      const rowCount = result.rowCount ?? 0;
      if (rowCount > 0) {
        await this.auditLog.record({
          action: 'TASK_DELETE',
          actorUserId: actorId,
          actorLabel: actor?.username,
          targetType: 'task',
          targetId: taskId,
          ip: ip ?? null,
        });
      }
      return { success: true, rowCount };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`deleteTask error: ${message}`);
      throw err;
    }
  }
}
