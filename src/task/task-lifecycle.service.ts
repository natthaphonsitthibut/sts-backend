import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { clean, generateToken, hashToken } from '../common/utils/helpers';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { CreateTaskDto, type TaskDurationUnit } from './dto/task.dto';
import { CaseTrackingOptionsService } from './case-tracking-options.service';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';
import { resolveAssigneeName } from './task-assignee-name';
import { MAX_LINK_LIFETIME_MS } from './task-link-expiry';

const LAPSED_ASSIGNMENT_CRON = '0 */10 * * * *';
import type { ActorContext, DataScope, QueryExecutor, QueryResultRow } from './task.types';

@Injectable()
export class TaskLifecycleService {
  private readonly logger = new Logger(TaskLifecycleService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
    private readonly auditLog: AuditLogService,
    private readonly tokenEncryption: TokenEncryptionService,
    private readonly caseTrackingOptions: CaseTrackingOptionsService,
    private readonly notificationsService?: NotificationsService,
    private readonly riskProfileService?: RiskProfileService,
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

  private resolveExpiresAt(value: string | null | undefined, fallbackExpiresAt: string): string {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (!trimmed) {
      return fallbackExpiresAt;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('รูปแบบเวลาสิ้นสุดไม่ถูกต้อง');
    }
    if (parsed.getTime() <= Date.now()) {
      throw new BadRequestException('เวลาสิ้นสุดต้องอยู่ในอนาคต');
    }
    if (parsed.getTime() > Date.now() + MAX_LINK_LIFETIME_MS) {
      throw new BadRequestException('อายุลิงก์ต้องไม่เกิน 90 วัน');
    }
    return parsed.toISOString();
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
    executor?: QueryExecutor,
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

  async listVisitAssignees(actor: ActorContext | undefined, studentUuid: string) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    this.taskPolicyService.assertCanCreateTask(currentActor, 'VISIT');

    const student = await this.taskRepository.findStudentTermMetadata(studentUuid);
    const schoolId = this.normalizeNumber(
      student?.SchoolID_Onec as string | number | null | undefined,
    );
    if (schoolId === null) {
      throw new BadRequestException('ไม่พบนักเรียนที่กำลังศึกษาอยู่ในระบบ');
    }
    await this.assertSchoolWithinActorScope(currentActor, schoolId);

    return (await this.taskRepository.listVisitAssignees(studentUuid)).map((row) => ({
      teacherId: row.teacher_id,
      displayName: row.display_name,
      isHomeroom: row.is_homeroom === true,
    }));
  }

  async createTask(actor: ActorContext | undefined, data: CreateTaskDto, baseUrl: string) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    const taskType = clean(data.task_type) || clean(data.type) || 'VISIT';
    let assigneeName = resolveAssigneeName({
      firstName: data.assigned_to_first_name,
      lastName: data.assigned_to_last_name,
      fullName: data.assigned_to_name,
    });
    let assignedName = assigneeName.fullName;
    let assignedEmail = clean(data.assigned_to_email);
    const selectedTeacherId = this.normalizeNumber(data.assigned_teacher_id);

    // A round for a student the system knows goes to a teacher in that student's
    // school — there is no guest assignee any more, and recording the real
    // teacher is authoritative for ownership and history. A manual visit that opens
    // a case for a student with no record yet has no roster to pick from, so it keeps
    // the free-text assignee while access still verifies an active teacher in the case school.
    const requiresTeacherAssignee =
      taskType === 'ASSIST' || (taskType === 'VISIT' && Boolean(clean(data.student_id)));
    if (requiresTeacherAssignee && selectedTeacherId === null) {
      throw new BadRequestException('กรุณาเลือกครูผู้รับมอบหมาย');
    }
    if (!assignedName && selectedTeacherId === null) {
      throw new BadRequestException('กรุณาระบุชื่อและนามสกุลผู้รับมอบหมาย');
    }
    if (
      selectedTeacherId === null &&
      assigneeName.usesStructuredInput &&
      (!assigneeName.firstName || !assigneeName.lastName)
    ) {
      throw new BadRequestException('กรุณาระบุชื่อและนามสกุลผู้รับมอบหมาย');
    }
    if (selectedTeacherId !== null && taskType !== 'VISIT' && taskType !== 'ASSIST') {
      throw new BadRequestException('เลือกครูผู้รับมอบหมายได้เฉพาะลิงก์ติดตามนักเรียน');
    }
    if (selectedTeacherId !== null && !clean(data.student_id)) {
      throw new BadRequestException('กรุณาเลือกนักเรียนก่อนเลือกครูผู้รับมอบหมาย');
    }
    this.taskPolicyService.assertCanCreateTask(currentActor, taskType);

    // Measures are picked when the assistance round is assigned, not when it is
    // reported, so the report form can show them read-only.
    const assistanceMeasureDetail = clean(data.assistance_measure_detail) || null;
    const assistanceMeasures =
      taskType === 'ASSIST'
        ? await this.caseTrackingOptions.getAssistanceMeasures(
            Array.isArray(data.assistance_measure_codes)
              ? data.assistance_measure_codes.map((code) => String(code).trim())
              : [],
            assistanceMeasureDetail,
          )
        : [];

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

    if (expiresMs > MAX_LINK_LIFETIME_MS) {
      throw new BadRequestException('อายุลิงก์ต้องไม่เกิน 90 วัน');
    }

    const fallbackExpiresAt = new Date(Date.now() + expiresMs).toISOString();
    const expiresAt = this.resolveExpiresAt(data.expires_at, fallbackExpiresAt);
    const opensAt = this.resolveOpensAt(data.opens_at, expiresAt);
    const responseToken = token;
    const responseExpiresAt = expiresAt;
    const responseTaskId: string = taskId;
    const assignmentReused = false;
    const tokenEncrypted = this.tokenEncryption.encrypt(token);
    let auditCaseId: number | null = null;
    let auditTargetSchoolId: number | null = null;
    let riskProfileStudentUuid: string | null = null;
    const auditTargetGrade = clean(data.target_grade) || null;
    const auditTargetRoom = clean(data.target_room) || null;
    const subjectId = this.normalizeNumber(data.subject_id);
    const actorId = resolveAuditActorId(currentActor);

    try {
      await this.taskRepository.withTransaction(async (executor) => {
        let caseId: number | null = null;
        const inputTargetSchoolId = this.normalizeNumber(data.target_school_id);
        let resolvedTargetSchoolId = inputTargetSchoolId;

        if (inputTargetSchoolId !== null) {
          await this.assertSchoolWithinActorScope(currentActor, inputTargetSchoolId, executor);
        } else {
          resolvedTargetSchoolId = this.getSingleActorSchoolId(currentActor);
        }

        if (taskType === 'VISIT' || taskType === 'ASSIST') {
          if (selectedTeacherId !== null) {
            const studentUuid = clean(data.student_id);
            const teacher = (
              await this.taskRepository.listVisitAssignees(studentUuid!, executor)
            ).find((candidate) => Number(candidate.teacher_id) === selectedTeacherId);
            if (!teacher) {
              throw new BadRequestException(
                'ครูผู้รับมอบหมายต้องเป็นครูที่ปฏิบัติงานอยู่ในโรงเรียนของนักเรียน',
              );
            }
            assignedName = teacher.display_name;
            assignedEmail = clean(teacher.email);
            assigneeName = {
              fullName: teacher.display_name,
              firstName: null,
              lastName: null,
              usesStructuredInput: false,
            };
          }
          const requestedCaseId = this.normalizeNumber(data.existing_case_id);
          const existingCaseId = requestedCaseId;

          if (existingCaseId) {
            const existingCase = await this.taskRepository.lockCaseForVisitAssignment(
              existingCaseId,
              currentActor,
              executor,
            );
            if (!existingCase) {
              throw new BadRequestException('ไม่พบเคสที่ต้องการมอบหมาย');
            }
            const existingStatus = clean(existingCase.status)?.toUpperCase();
            if (!['OPEN', 'IN_PROGRESS', 'STUDENT_NOT_FOUND'].includes(existingStatus || '')) {
              throw new BadRequestException('สถานะเคสนี้ไม่อนุญาตให้มอบหมายการติดตาม');
            }
            // A follow-up round and an assistance round are different work; the
            // case phase decides which one may be assigned right now.
            const existingPhase =
              clean(existingCase.workflow_phase_code)?.toUpperCase() || 'FOLLOW_UP';
            const requiredPhase = taskType === 'ASSIST' ? 'ASSISTANCE' : 'FOLLOW_UP';
            if (existingPhase !== requiredPhase) {
              throw new BadRequestException(
                taskType === 'ASSIST'
                  ? 'เคสนี้ยังไม่อยู่ในขั้นตอนให้ความช่วยเหลือ'
                  : 'เคสนี้อยู่ในขั้นตอนให้ความช่วยเหลือ ไม่สามารถมอบหมายการติดตามได้',
              );
            }
            if (existingCase.has_live_assignment === true) {
              throw new BadRequestException('เคสนี้มีลิงก์มอบหมายที่ยังใช้งานได้อยู่แล้ว');
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
            if (
              clean(existingCase.student_uuid) &&
              clean(data.student_id) &&
              clean(existingCase.student_uuid) !== clean(data.student_id)
            ) {
              throw new BadRequestException('เคสเดิมไม่ตรงกับนักเรียนที่เลือก');
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

            const activeCase = studentUuid
              ? await this.taskRepository.findActiveCaseByStudentUuid(
                  studentUuid,
                  currentActor,
                  executor,
                )
              : null;
            const activeCaseId = this.normalizeNumber(
              activeCase?.id as string | number | null | undefined,
            );
            caseId =
              activeCaseId ??
              (await this.taskRepository.createCase(
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
              ));

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

        await this.taskRepository.createTask(
          {
            taskId,
            caseId,
            taskType,
            targetGrade: auditTargetGrade,
            targetRoom: auditTargetRoom,
            targetSchoolId: resolvedTargetSchoolId,
            createdBy: resolveAuditActorId(currentActor),
            assistanceMeasureCodes: assistanceMeasures.map((measure) => measure.code),
            assistanceMeasureDetail: assistanceMeasures.some((measure) => measure.requiresDetail)
              ? assistanceMeasureDetail
              : null,
          },
          executor,
        );

        await this.taskRepository.createTaskLink(
          {
            linkId,
            taskId,
            tokenHash,
            tokenEncrypted,
            // Both the legacy input validation and selected-teacher lookup above
            // guarantee a name before a link can be persisted.
            assignedToName: assignedName || '',
            assignedToFirstName: assigneeName.firstName,
            assignedToLastName: assigneeName.lastName,
            assignedToPhone: clean(data.assigned_to_phone),
            assignedToEmail: assignedEmail,
            assignedTeacherId: selectedTeacherId,
            expiresAt,
            opensAt,
            subject: clean(data.subject),
            assignmentNote: clean(data.assignment_note),
            subjectId,
            createdBy: resolveAuditActorId(currentActor),
          },
          executor,
        );
      });

      if (!assignmentReused) {
        await this.auditLog.record({
          action: 'TASK_CREATE',
          actorUserId: actorId,
          actorLabel: currentActor.username,
          targetType: 'task',
          targetId: taskId,
          metadata: {
            taskType,
            schoolId: auditTargetSchoolId,
            grade: auditTargetGrade,
            room: auditTargetRoom,
            caseId: auditCaseId,
          },
          ip: null,
        });
      }
      if (!assignmentReused && auditCaseId !== null) {
        try {
          await this.notificationsService?.notifyCaseStatusChanged({
            caseId: auditCaseId,
            studentName: clean(data.student_name) || null,
            schoolId: auditTargetSchoolId,
            nextStatus: 'IN_PROGRESS',
            actorUserId: actorId,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to notify assigned case after commit: ${message}`);
        }
      }
      if (!assignmentReused && riskProfileStudentUuid) {
        await this.riskProfileService
          ?.requestStudentRecalculation([riskProfileStudentUuid], 'case-task-create')
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to enqueue case risk profile recalculation: ${message}`);
          });
      }

      const magicLink = `${baseUrl}/task/${responseToken}`;
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
        task_id: responseTaskId,
        magic_link: magicLink,
        qr_code_data: qrDataUrl,
        expires_at: responseExpiresAt,
        reused: assignmentReused,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`createTask error: ${message}`);
      throw err;
    }
  }

  /**
   * Every ten minutes, hand back any case whose assignment link ran out with no
   * report. Read-side expiry was not enough: the case kept reading รอติดตาม, so
   * work that had silently lapsed never surfaced in the รอมอบหมาย queue.
   */
  @Cron(LAPSED_ASSIGNMENT_CRON, {
    timeZone: BANGKOK_TIME_ZONE,
    name: 'task_lapsed_assignment_sweep',
  })
  async sweepLapsedAssignments(): Promise<{ expired: number }> {
    try {
      const lapsed = await this.taskRepository.expireLapsedAssignments();
      for (const entry of lapsed) {
        await this.auditLog.record({
          action: 'TASK_EXPIRE',
          actorUserId: null,
          actorLabel: 'ระบบ',
          targetType: 'task',
          targetId: entry.taskId,
          metadata: { caseId: entry.caseId },
          ip: null,
        });
      }
      return { expired: lapsed.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Lapsed assignment sweep failed: ${message}`);
      return { expired: 0 };
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
