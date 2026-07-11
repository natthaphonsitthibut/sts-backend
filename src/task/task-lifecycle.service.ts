import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { finalizePersistedDataScope } from '../auth/auth.types';
import { clean, generateToken, hashToken } from '../common/utils/helpers';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { CreateTaskDto, type TaskDurationUnit } from './dto/task.dto';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';
import type { ActorContext, DataScope, QueryExecutor, QueryResultRow } from './task.types';

const OVERDUE_TASK_REMINDER_CRON = '0 15 4 * * *';

@Injectable()
export class TaskLifecycleService {
  private readonly logger = new Logger(TaskLifecycleService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
    private readonly auditLog: AuditLogService,
    private readonly tokenEncryption: TokenEncryptionService,
    private readonly notificationsService?: NotificationsService,
    private readonly riskProfileService?: RiskProfileService,
  ) {}

  /**
   * Notify the assigning staff when a home-visit link passes its expiry without
   * being completed. Claims-and-marks in one query so each link reminds once.
   * `now` is injectable for tests. Best-effort — never blocks the cron.
   */
  async remindOverdueTaskLinks(now = new Date()): Promise<{ notified: number }> {
    const overdue = await this.taskRepository.claimOverdueTaskLinks(now);
    let notified = 0;
    for (const link of overdue) {
      if (link.created_by == null) {
        continue;
      }
      await this.notificationsService?.notifyTaskOverdue({
        linkId: link.id,
        taskId: link.task_id,
        recipientUserId: link.created_by,
        assigneeName: link.assigned_to_name,
      });
      notified += 1;
    }
    if (notified > 0) {
      this.logger.log(`Sent ${notified} overdue home-visit reminder(s).`);
    }
    return { notified };
  }

  @Cron(OVERDUE_TASK_REMINDER_CRON, {
    timeZone: BANGKOK_TIME_ZONE,
    name: 'overdue_task_link_reminder',
  })
  async runOverdueTaskReminders(): Promise<void> {
    try {
      await this.remindOverdueTaskLinks();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Overdue task reminder job failed: ${message}`);
    }
  }

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

  /**
   * Validate an optional scheduled-open time against the link's expiry. A blank
   * value (the common case) means the link opens immediately. A supplied time
   * must be a valid instant strictly before expiry — a link that would "open"
   * only after it expires is never usable and is rejected rather than stored.
   */
  private resolveOpensAt(value: string | null | undefined, expiresAt: string): string | null {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) {
      return null;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('รูปแบบเวลาที่เปิดใช้งานไม่ถูกต้อง');
    }
    if (parsed.getTime() >= new Date(expiresAt).getTime()) {
      throw new BadRequestException('เวลาที่เปิดใช้งานต้องอยู่ก่อนเวลาหมดอายุของลิงก์');
    }
    return parsed.toISOString();
  }

  private normalizePositiveIntList(value: unknown): number[] {
    if (value == null) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new BadRequestException('timetable_slot_ids must be an array');
    }

    const normalized = value.map((item) => {
      const parsed =
        typeof item === 'number'
          ? item
          : typeof item === 'string' && item.trim().length > 0
            ? Number(item)
            : Number.NaN;
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new BadRequestException('timetable_slot_ids must contain positive integers');
      }
      return parsed;
    });

    if (new Set(normalized).size !== normalized.length) {
      throw new BadRequestException('timetable_slot_ids must not contain duplicates');
    }

    return normalized;
  }

  private buildFullName(firstName: string | null, lastName: string | null): string | null {
    return [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  }

  private buildFullAddress(
    line: string | null,
    subDistrict: string | null,
    district: string | null,
    province: string | null,
    postalCode: string | null,
  ): string | null {
    return (
      [line, subDistrict, district, province, postalCode].filter(Boolean).join(' ').trim() || null
    );
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

  private async assertTimetableSlotsMatchTaskLink(
    input: {
      taskType: string;
      slotIds: number[];
      subjectId: number | null;
      targetSchoolId: number | null;
      targetGrade: string | null;
      targetRoom: string | null;
    },
    executor: QueryExecutor,
  ): Promise<void> {
    if (input.slotIds.length === 0) {
      return;
    }
    if (input.taskType !== 'ATTENDANCE') {
      throw new BadRequestException('timetable_slot_ids are only supported for ATTENDANCE tasks');
    }
    if (input.subjectId === null) {
      throw new BadRequestException('subject_id is required when timetable_slot_ids are provided');
    }
    if (input.targetSchoolId === null || !input.targetGrade || !input.targetRoom) {
      throw new BadRequestException(
        'target_school_id, target_grade, and target_room are required for timetable slots',
      );
    }

    const targetRoomNo = Number.parseInt(input.targetRoom, 10);
    if (!Number.isInteger(targetRoomNo) || targetRoomNo <= 0) {
      throw new BadRequestException('target_room must be a positive room number');
    }

    const slots = await this.taskRepository.listTimetableSlotsForTaskLink(input.slotIds, executor);
    if (slots.length !== input.slotIds.length) {
      throw new BadRequestException('ไม่พบคาบเรียนบางรายการหรือคาบเรียนถูกลบแล้ว');
    }

    for (const slot of slots) {
      if (
        Number(slot.school_id) !== input.targetSchoolId ||
        String(slot.grade_label) !== input.targetGrade ||
        Number(slot.room_no) !== targetRoomNo ||
        Number(slot.subject_id) !== input.subjectId
      ) {
        throw new BadRequestException('คาบเรียนไม่ตรงกับขอบเขตหรือวิชาของลิงก์');
      }
    }
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
    // Persist LOGIN scopes with an explicit nationwide marker: scoped reads
    // fail closed on an empty scope, so a confirmed-nationwide link must be
    // stored as global:true rather than an empty object.
    const loginDataScope =
      taskType === 'LOGIN'
        ? finalizePersistedDataScope(this.taskPolicyService.normalizeScope(data.data_scope))
        : {};

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
    const opensAt = this.resolveOpensAt(data.opens_at, expiresAt);
    const magicLink = `${baseUrl}/task/${token}`;
    const tokenEncrypted = this.tokenEncryption.encrypt(token);
    let auditCaseId: number | null = null;
    let auditTargetSchoolId: number | null = null;
    let riskProfileStudentUuid: string | null = null;
    const auditTargetGrade = clean(data.target_grade) || null;
    const auditTargetRoom = clean(data.target_room) || null;
    const subjectId = this.normalizeNumber(data.subject_id);
    const timetableSlotIds = this.normalizePositiveIntList(data.timetable_slot_ids);
    const sourceFieldFollowerId = this.normalizeNumber(data.source_field_follower_id);
    const campaignTargetId = this.normalizeNumber(data.campaign_target_id);

    if ((sourceFieldFollowerId !== null || campaignTargetId !== null) && taskType !== 'VISIT') {
      throw new BadRequestException(
        'campaign follower assignment is only supported for VISIT tasks',
      );
    }
    if (campaignTargetId !== null && sourceFieldFollowerId === null) {
      throw new BadRequestException('source_field_follower_id is required with campaign_target_id');
    }
    if (sourceFieldFollowerId !== null && !assignedEmail) {
      throw new BadRequestException(
        'assigned_to_email is required when assigning a field follower',
      );
    }

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
            riskProfileStudentUuid =
              typeof existingCase.student_uuid === 'string'
                ? clean(existingCase.student_uuid) || null
                : null;
            await this.taskRepository.updateCaseStatus(
              caseId,
              'IN_PROGRESS',
              executor,
              currentActor,
            );
          } else {
            const studentFirstName = clean(data.student_first_name);
            const studentLastName = clean(data.student_last_name);
            const studentName =
              clean(data.student_name) || this.buildFullName(studentFirstName, studentLastName);
            const addressLine = clean(data.address_line);
            const addressProvince = clean(data.address_province);
            const addressDistrict = clean(data.address_district);
            const addressSubDistrict = clean(data.address_sub_district);
            const postalCode = clean(data.postal_code);
            const studentAddress =
              clean(data.student_address) ||
              this.buildFullAddress(
                addressLine,
                addressSubDistrict,
                addressDistrict,
                addressProvince,
                postalCode,
              );
            const studentUuid = clean(data.student_id) || null;
            riskProfileStudentUuid = studentUuid;
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
                studentFirstName,
                studentLastName,
                studentSchool: clean(data.student_school),
                studentAddress,
                addressLine,
                addressProvince,
                addressDistrict,
                addressSubDistrict,
                postalCode,
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
        auditCaseId = caseId;
        auditTargetSchoolId = resolvedTargetSchoolId;

        await this.assertTimetableSlotsMatchTaskLink(
          {
            taskType,
            slotIds: timetableSlotIds,
            subjectId,
            targetSchoolId: resolvedTargetSchoolId,
            targetGrade: auditTargetGrade,
            targetRoom: auditTargetRoom,
          },
          executor,
        );

        await this.taskRepository.createTask(
          {
            taskId,
            caseId,
            taskType,
            targetGrade: auditTargetGrade,
            targetRoom: auditTargetRoom,
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
            tokenEncrypted,
            delegationDepth: 0,
            assignedToName: assignedName,
            assignedToPhone: clean(data.assigned_to_phone),
            assignedToEmail: assignedEmail,
            expiresAt,
            opensAt,
            subject: clean(data.subject),
            subjectId,
            // Email-assigned links require OTP (start unverified); links with no
            // email can't be OTP'd, so mark them pre-verified to skip the gate.
            otpVerified: assignedEmail ? 0 : 1,
            createdBy: resolveAuditActorId(currentActor),
            loginRole,
            loginPermissions,
            loginDataScope,
            sourceFieldFollowerId,
          },
          executor,
        );
        await this.taskRepository.insertTaskLinkTimetableSlots(
          linkId,
          timetableSlotIds,
          resolveAuditActorId(currentActor),
          executor,
        );
        if (campaignTargetId !== null && sourceFieldFollowerId !== null && caseId !== null) {
          const assigned = await this.taskRepository.assignFollowerCampaignTarget(
            {
              campaignTargetId,
              sourceFieldFollowerId,
              taskLinkId: linkId,
              caseId,
              actorId: resolveAuditActorId(currentActor),
            },
            executor,
          );
          if (!assigned) {
            throw new BadRequestException(
              'ไม่สามารถมอบหมายเคสนี้ได้ กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่',
            );
          }
        }
      });

      await this.auditLog.record({
        action: 'TASK_CREATE',
        actorUserId: resolveAuditActorId(currentActor),
        actorLabel: currentActor.username,
        targetType: 'task',
        targetId: taskId,
        metadata: {
          taskType,
          schoolId: auditTargetSchoolId,
          grade: auditTargetGrade,
          room: auditTargetRoom,
          caseId: auditCaseId,
          scope: taskType === 'LOGIN' ? loginDataScope : undefined,
        },
        ip: null,
      });
      if (riskProfileStudentUuid) {
        await this.riskProfileService
          ?.enqueueStudents([riskProfileStudentUuid], 'case-task-create')
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to enqueue case risk profile recalculation: ${message}`);
          });
      }

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
