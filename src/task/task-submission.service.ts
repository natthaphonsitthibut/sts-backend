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
import { NotificationsService } from '../notifications/notifications.service';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { hashToken } from '../common/utils/helpers';
import { SaveTaskSubmissionDto } from './dto/task.dto';
import { TaskAccessService } from './task-access.service';
import { TaskRepository } from './task.repository';
import { CaseTrackingOptionsService } from './case-tracking-options.service';

/** Clock-skew allowance for a guest-reported visit timestamp. */
const VISITED_AT_FUTURE_GRACE_MS = 5 * 60 * 1000;

@Injectable()
export class TaskSubmissionService {
  private readonly logger = new Logger(TaskSubmissionService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskAccessService: TaskAccessService,
    private readonly automationService: AutomationService,
    private readonly notificationsService: NotificationsService,
    private readonly auditLog: AuditLogService,
    private readonly caseTrackingOptions: CaseTrackingOptionsService,
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
   * expired, admin-locked, or completed links, and links whose type
   * does not match the write surface. Returns the validated link shape.
   */
  private validateUsableLink(
    task: Awaited<ReturnType<TaskAccessService['getTaskByToken']>>,
    expectedTypes: ReadonlyArray<'VISIT' | 'ASSIST'>,
  ): Record<string, unknown> {
    if (!task) {
      throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
    }

    const link = task;

    if (link.error) {
      const status = typeof link.status === 'string' ? link.status : '';
      const message = typeof link.error === 'string' ? link.error : 'ลิงก์ใช้งานไม่ได้';
      if (status === 'EXPIRED' || status === 'CANCELLED') {
        throw new GoneException(message);
      }
      if (status === 'ADMIN_LOCKED') {
        throw new ForbiddenException(message);
      }
      if (status === 'SCHEDULED') {
        throw new ForbiddenException('ลิงก์นี้ยังไม่เปิดใช้งาน');
      }
      if (status === 'COMPLETED') {
        throw new ConflictException(message);
      }
      throw new BadRequestException(message);
    }

    if (typeof link.task_type !== 'string' || !expectedTypes.includes(link.task_type as never)) {
      throw new ForbiddenException('ลิงก์นี้ไม่รองรับการบันทึกประเภทนี้');
    }

    if (link.auth_required === true) {
      throw new ForbiddenException('กรุณายืนยันตัวตนด้วย Google หรือ AraID ก่อนบันทึกข้อมูล');
    }

    return link;
  }

  async assertVisitSubmissionAccess(
    token: string,
    sessionToken?: string,
  ): Promise<Record<string, unknown>> {
    const task = await this.taskAccessService.getTaskByToken(token, sessionToken);
    return this.validateUsableLink(task, ['VISIT', 'ASSIST']);
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

  private toTimestamp(value: unknown): number | null {
    const raw = this.toScalarString(value);
    if (!raw) {
      return null;
    }
    const parsed = new Date(raw).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }

  /**
   * The visit timestamp is guest-supplied evidence on a public magic link, so it
   * is bounded on both ends: never after now (a small grace absorbs client clock
   * skew) and never before the assignment window opened. Without the bounds a
   * link holder could date a home visit years away from when it happened.
   */
  private normalizeTaskTimestamp(
    value: unknown,
    task: Record<string, unknown>,
    fieldLabel: string,
  ): string {
    const raw = this.toScalarString(value);
    if (!raw) {
      throw new BadRequestException(`กรุณาระบุ${fieldLabel}`);
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`${fieldLabel}ไม่ถูกต้อง`);
    }
    if (parsed.getTime() > Date.now() + VISITED_AT_FUTURE_GRACE_MS) {
      throw new BadRequestException(`${fieldLabel}ต้องไม่อยู่ในอนาคต`);
    }
    const assignedFrom = this.toTimestamp(task.opens_at) ?? this.toTimestamp(task.created_at);
    if (assignedFrom !== null && parsed.getTime() < assignedFrom) {
      throw new BadRequestException(`${fieldLabel}ต้องไม่อยู่ก่อนเวลาที่ได้รับมอบหมาย`);
    }
    return parsed.toISOString();
  }

  private composeUpdatedAddress(
    line: string,
    subDistrict: string,
    district: string,
    province: string,
    postalCode: string,
  ): string {
    return [line, `ต.${subDistrict}`, `อ.${district}`, `จ.${province}`, postalCode].join(' ');
  }

  private normalizeOptionalPositiveInt(value: unknown, fieldName: string): number | null {
    if (value == null || value === '') {
      return null;
    }
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim().length > 0
          ? Number(value)
          : Number.NaN;
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(`${fieldName} must be a positive integer`);
    }
    return parsed;
  }

  async saveTaskSubmission(token: string, data: SaveTaskSubmissionDto, sessionToken?: string) {
    try {
      const task = await this.assertVisitSubmissionAccess(token, sessionToken);

      const tokenHash = hashToken(token);
      const link = await this.taskRepository.findTaskSubmissionContextByTokenHash(tokenHash);

      if (!link) {
        throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
      }

      const caseId = typeof link.case_id === 'number' ? link.case_id : null;
      // A link holder reports assigned work only. Case action fields from legacy
      // clients are deliberately ignored; the authenticated reviewer decides next.
      const decision = caseId
        ? await this.caseTrackingOptions.getFollowUpDecision('REQUEST_REVIEW')
        : null;
      if (decision && !decision.targetStatus) {
        throw new BadRequestException('ผลการส่งรายงานไม่มีสถานะปลายทาง');
      }
      const isAssistance = link.task_type === 'ASSIST';
      const visitedAt = isAssistance
        ? null
        : this.normalizeTaskTimestamp(data.visited_at, task, 'วันและเวลาที่ไปเยี่ยม/ติดตาม');
      const assistedAt = isAssistance
        ? this.normalizeTaskTimestamp(data.assisted_at, task, 'วันและเวลาที่ให้ความช่วยเหลือ')
        : null;
      const submittedExecutionOutcomeCode =
        this.toScalarString(data.task_execution_outcome_code)?.toUpperCase() ?? null;
      const nonFollowUpReasonCode =
        this.toScalarString(data.non_follow_up_reason_code)?.toUpperCase() ?? null;
      const disadvantageInput = data.disadvantage_type_codes ?? [];
      const disabilityInput = data.disability_type_codes ?? [];
      const studentUuid = this.toScalarString(link.student_uuid);
      const homeVisitExceptionCode =
        this.toScalarString(data.home_visit_exception_code)?.toUpperCase() ?? null;
      const executionOutcomeCode = isAssistance
        ? submittedExecutionOutcomeCode
        : homeVisitExceptionCode === 'STUDENT_NOT_FOUND'
          ? 'NOT_SUCCEEDED'
          : 'SUCCEEDED';
      const followUpProblemCategoryCode =
        this.toScalarString(data.follow_up_problem_category_code)?.toUpperCase() ?? null;
      const absenceReasonCode =
        this.toScalarString(data.absence_reason_code)?.toUpperCase() ?? null;
      const absenceReasonCategoryCode =
        this.toScalarString(data.absence_reason_category_code)?.toUpperCase() ?? null;
      const parentalStatusCode =
        this.toScalarString(data.parental_status_code)?.toUpperCase() ?? null;
      const guardianTypeCode = this.toScalarString(data.guardian_type_code)?.toUpperCase() ?? null;
      const residenceEnvironmentDetail = this.toScalarString(data.residence_environment_detail);
      const residenceEnvironmentCodes = (data.residence_environment_codes ?? []).map((code) =>
        code.trim().toUpperCase(),
      );
      const requestedContactChannelCode = isAssistance
        ? null
        : (this.toScalarString(data.contact_channel_code)?.toUpperCase() ?? null);
      const [
        executionOutcome,
        nonFollowUpReason,
        disadvantageTypeCodes,
        disabilityTypeCodes,
        homeVisitException,
        followUpProblemCategory,
        absenceSelection,
        parentalStatus,
        guardianType,
        residenceEnvironments,
        contactChannelCode,
      ] = await Promise.all([
        this.caseTrackingOptions.getTaskExecutionOutcome(executionOutcomeCode),
        this.caseTrackingOptions.getNonFollowUpReason(nonFollowUpReasonCode),
        this.caseTrackingOptions.getCareObservationCodes('DISADVANTAGE', disadvantageInput),
        this.caseTrackingOptions.getCareObservationCodes('DISABILITY', disabilityInput),
        this.caseTrackingOptions.getHomeVisitException(homeVisitExceptionCode),
        this.caseTrackingOptions.getFollowUpProblemCategory(followUpProblemCategoryCode),
        this.caseTrackingOptions.getAbsenceSelection(absenceReasonCode, absenceReasonCategoryCode),
        this.caseTrackingOptions.getParentalStatus(parentalStatusCode),
        this.caseTrackingOptions.getGuardianType(guardianTypeCode),
        this.caseTrackingOptions.getResidenceEnvironments(
          residenceEnvironmentCodes,
          residenceEnvironmentDetail,
        ),
        this.caseTrackingOptions.getContactChannel(requestedContactChannelCode),
      ]);
      if (nonFollowUpReason && (isAssistance || executionOutcome !== 'NOT_SUCCEEDED')) {
        throw new BadRequestException('สาเหตุการไม่ติดตามใช้ได้เฉพาะงานติดตามที่ยังไม่สำเร็จ');
      }
      if (isAssistance && (disadvantageTypeCodes.length > 0 || disabilityTypeCodes.length > 0)) {
        throw new BadRequestException('ข้อมูลจากการเยี่ยมบ้านใช้กับงานติดตามเท่านั้น');
      }
      if ((disadvantageTypeCodes.length > 0 || disabilityTypeCodes.length > 0) && !studentUuid) {
        throw new BadRequestException('เคสนี้ไม่มีนักเรียนสำหรับบันทึกข้อมูลจากการติดตาม');
      }
      if (isAssistance && (absenceSelection.reasonCode || absenceSelection.categoryCode)) {
        throw new BadRequestException('สาเหตุการขาดใช้กับงานติดตามเท่านั้น');
      }
      // A not-found visit keeps the dedicated re-assignment lane open: it is an
      // operational exception, not a reviewer decision. Other completed work
      // still enters the review gate before the case can be resolved.
      const studentNotFound = homeVisitException?.code === 'STUDENT_NOT_FOUND';
      const targetCaseStatus = studentNotFound ? 'STUDENT_NOT_FOUND' : decision?.targetStatus;
      const assistanceDetail = isAssistance
        ? (this.toScalarString(data.assistance_detail) ?? null)
        : null;
      const executionOutcomeDetail =
        isAssistance && executionOutcome === 'NOT_SUCCEEDED'
          ? (this.toScalarString(data.execution_outcome_detail) ?? null)
          : null;
      const contactPersonName = isAssistance
        ? null
        : (this.toScalarString(data.contact_person_name) ?? null);
      const guardianTypeDetail = this.toScalarString(data.guardian_type_detail);
      if (guardianType?.requiresDetail && !guardianTypeDetail) {
        throw new BadRequestException('กรุณาระบุผู้ปกครอง');
      }
      const causeDetail = this.toScalarString(data.notes ?? data.cause_detail);
      if (studentNotFound && !causeDetail) {
        throw new BadRequestException('กรุณาระบุสิ่งที่ตรวจสอบและแนวทางติดตามต่อ');
      }
      const updatedAddressLine = this.toScalarString(data.updated_address_line);
      const updatedAddressProvince = this.toScalarString(data.updated_address_province);
      const updatedAddressDistrict = this.toScalarString(data.updated_address_district);
      const updatedAddressSubDistrict = this.toScalarString(data.updated_address_sub_district);
      const updatedPostalCode = this.toScalarString(data.updated_postal_code);
      if (
        homeVisitException?.requiresUpdatedAddress &&
        (!updatedAddressLine ||
          !updatedAddressProvince ||
          !updatedAddressDistrict ||
          !updatedAddressSubDistrict ||
          !updatedPostalCode)
      ) {
        throw new BadRequestException('กรุณากรอกที่อยู่ใหม่ให้ครบถ้วน');
      }
      if (updatedPostalCode && !/^\d{5}$/.test(updatedPostalCode)) {
        throw new BadRequestException('รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก');
      }
      const addressChanged =
        homeVisitException?.code === 'ADDRESS_CHANGED' ||
        (!homeVisitException && this.normalizeBoolean(data.address_changed));
      const structuredUpdatedAddress =
        homeVisitException?.requiresUpdatedAddress &&
        updatedAddressLine &&
        updatedAddressProvince &&
        updatedAddressDistrict &&
        updatedAddressSubDistrict &&
        updatedPostalCode
          ? this.composeUpdatedAddress(
              updatedAddressLine,
              updatedAddressSubDistrict,
              updatedAddressDistrict,
              updatedAddressProvince,
              updatedPostalCode,
            )
          : null;
      await this.taskRepository.withTransaction(async (executor) => {
        const live = await this.taskRepository.lockLiveTaskLink(String(link.link_id), executor);
        if (!live) {
          throw new ConflictException('ลิงก์นี้ถูกลบแล้ว');
        }
        const submissionId = await this.taskRepository.insertTaskSubmission(
          {
            linkId: String(link.link_id),
            visitLat: this.normalizeNumber(data.visit_lat),
            visitLng: this.normalizeNumber(data.visit_lng),
            visitedAt,
            followUpProblemCategoryCode: followUpProblemCategory?.code ?? null,
            absenceReasonCode: absenceSelection.reasonCode,
            absenceReasonCategoryCode: absenceSelection.categoryCode,
            parentalStatusCode: parentalStatus?.code ?? null,
            guardianTypeCode: guardianType?.code ?? null,
            // A detail without a guardian type has nothing to qualify, and the
            // DB CHECK rejects it — drop it instead of failing the submission.
            guardianTypeDetail: guardianType ? guardianTypeDetail : null,
            residenceEnvironmentCodes: residenceEnvironments.map((option) => option.code),
            residenceEnvironmentDetail,
            causeDetail,
            recommendation: data.recommendation ?? null,
            photoPaths: data.photo_paths ?? null,
            addressChanged,
            homeVisitExceptionCode: homeVisitException?.code ?? null,
            updatedStudentAddress:
              structuredUpdatedAddress ?? this.toScalarString(data.updated_student_address),
            updatedAddressLine: addressChanged ? updatedAddressLine : null,
            updatedAddressProvince: addressChanged ? updatedAddressProvince : null,
            updatedAddressDistrict: addressChanged ? updatedAddressDistrict : null,
            updatedAddressSubDistrict: addressChanged ? updatedAddressSubDistrict : null,
            updatedPostalCode: addressChanged ? updatedPostalCode : null,
            updatedLat: this.normalizeNumber(data.updated_lat),
            updatedLng: this.normalizeNumber(data.updated_lng),
            caseFollowUpDecision: studentNotFound ? null : (decision?.code ?? null),
            caseResolutionOutcomeCode: null,
            assistedAt,
            assistanceDetail,
            taskExecutionOutcomeCode: executionOutcome,
            executionOutcomeDetail,
            contactPersonName,
            contactChannelCode,
            nonFollowUpReasonCode: nonFollowUpReason,
          },
          executor,
        );
        await this.taskRepository.insertHomeVisitCareObservations(
          submissionId,
          studentUuid ?? '',
          disadvantageTypeCodes,
          disabilityTypeCodes,
          executor,
        );

        if (
          (link.task_type === 'VISIT' || link.task_type === 'ASSIST') &&
          caseId !== null &&
          targetCaseStatus
        ) {
          const nextSummary = causeDetail || homeVisitException?.label || 'บันทึกผลการลงพื้นที่';
          // When the visitor flags the home location as wrong, persist the
          // corrected coordinates to the case independently of the address TEXT —
          // changing only the pin (no typed address) must still update the canonical
          // student_lat/lng. Address text updates only when actually provided.
          const caseTransitioned = await this.taskRepository.updateCaseAfterSubmission(
            {
              caseId,
              nextStatus: targetCaseStatus,
              completionOutcomeCode: null,
              nextSummary,
              // Trim to null so an empty/whitespace address does not wipe the
              // existing one via COALESCE (pin-only correction sends no address).
              updatedStudentAddress: addressChanged
                ? (structuredUpdatedAddress ?? data.updated_student_address?.trim() ?? null)
                : null,
              updatedAddressLine: addressChanged ? updatedAddressLine : null,
              updatedAddressProvince: addressChanged ? updatedAddressProvince : null,
              updatedAddressDistrict: addressChanged ? updatedAddressDistrict : null,
              updatedAddressSubDistrict: addressChanged ? updatedAddressSubDistrict : null,
              updatedPostalCode: addressChanged ? updatedPostalCode : null,
              updatedLat: addressChanged
                ? (this.normalizeNumber(data.updated_lat) ?? this.normalizeNumber(data.visit_lat))
                : null,
              updatedLng: addressChanged
                ? (this.normalizeNumber(data.updated_lng) ?? this.normalizeNumber(data.visit_lng))
                : null,
              clearMissingCoordinates: structuredUpdatedAddress !== null,
            },
            executor,
          );
          if (!caseTransitioned) {
            throw new ConflictException('เคสนี้ถูกดำเนินการไปแล้ว กรุณาโหลดข้อมูลล่าสุด');
          }
        }

        await this.taskRepository.updateTaskStatus(String(link.task_id), 'COMPLETED', executor);
        await this.taskRepository.updateTaskLinkStatus(String(link.link_id), 'COMPLETED', executor);
      });

      if (caseId !== null && targetCaseStatus) {
        try {
          await this.notificationsService.notifyCaseStatusChanged({
            caseId,
            studentName: this.toScalarString(link.student_name),
            schoolId: this.normalizeNumber(link.school_id as string | number | null | undefined),
            nextStatus: targetCaseStatus,
            actorUserId: null,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to notify case status after submission commit: ${message}`);
        }
      }

      this.logger.log(
        `[saveTaskSubmission] success decision=${studentNotFound ? 'REASSIGN' : (decision?.code ?? 'NONE')} exception=${homeVisitException?.code ?? 'NONE'}`,
      );
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`saveTaskSubmission error: ${message}`);
      throw err;
    }
  }
}
