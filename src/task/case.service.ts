import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { clean } from '../common/utils/helpers';
import type { AuthenticatedRequestUser } from '../auth';
import { isRestrictedExecutive } from '../auth/permissions.constants';
import * as crypto from 'crypto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { buildStudentTermAddress } from '../common/utils/student-address.util';
import { encodeMediaVersion } from '../common/utils/media-version.util';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { CancelCaseAssignmentDto, OpenCaseDto, ReviewCaseDto } from './dto/task.dto';
import { CaseTrackingOptionsService } from './case-tracking-options.service';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';

@Injectable()
export class CaseService {
  private readonly logger = new Logger(CaseService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
    private readonly auditLog: AuditLogService,
    private readonly notificationsService: NotificationsService,
    private readonly caseTrackingOptions: CaseTrackingOptionsService,
    private readonly riskProfileService?: RiskProfileService,
  ) {}

  private normalizeText(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value).trim();
    }

    return '';
  }

  private normalizeNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isInteger(value)) {
      return value;
    }
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isInteger(parsed) ? parsed : null;
    }
    return null;
  }

  private normalizeCoordinate(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(this.normalizeText(value));
    return Number.isFinite(parsed) ? parsed : null;
  }

  private assertCanReviewCaseAction(
    actor: AuthenticatedRequestUser,
    requiredPermission: string,
  ): void {
    if (!this.taskPolicyService.hasPermission(actor, 'dashboard')) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับเคสนี้');
    }

    if (!this.taskPolicyService.hasPermission(actor, requiredPermission)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับเคสนี้');
    }
  }

  private actorLabel(actor?: AuthenticatedRequestUser): string | null {
    const actorName = [actor?.FirstName, actor?.LastName].filter(Boolean).join(' ').trim();
    return actor?.username || actorName || null;
  }

  private mapCaseDetail(row: Record<string, unknown>, includeTeacherComment = false) {
    return {
      id: this.normalizeNumber(row.id),
      student_id: this.normalizeText(row.student_id) || null,
      student_photo_url:
        this.normalizeText(row.student_id) && this.normalizeText(row.student_photo_storage_key)
          ? `/api/students/${encodeURIComponent(this.normalizeText(row.student_id))}/photo?v=${encodeMediaVersion(row.student_photo_updated_at)}`
          : null,
      student_name: this.normalizeText(row.student_name),
      student_school: this.normalizeText(row.student_school) || null,
      student_address: this.normalizeText(row.student_address) || null,
      student_phone: this.normalizeText(row.student_phone) || null,
      student_lat: this.normalizeNumber(row.student_lat),
      student_lng: this.normalizeNumber(row.student_lng),
      teacher_comment: includeTeacherComment
        ? this.normalizeText(row.teacher_comment) || null
        : null,
      reason_flagged: this.normalizeText(row.reason_flagged) || null,
      status: this.normalizeText(row.status),
      status_label: this.normalizeText(row.status_label) || null,
      completion_outcome_code: this.normalizeText(row.completion_outcome_code) || null,
      completion_outcome_label: this.normalizeText(row.completion_outcome_label) || null,
      workflow_phase_code: this.normalizeText(row.workflow_phase_code) || null,
      display_status_label:
        this.normalizeText(row.display_status_label) ||
        this.normalizeText(row.status_label) ||
        null,
      status_badge_variant: this.normalizeText(row.status_badge_variant) || null,
      school_id: this.normalizeNumber(row.school_id),
      grade: this.normalizeText(row.grade) || null,
      room: this.normalizeText(row.room) || null,
      task_id: this.normalizeText(row.task_id) || null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
    };
  }

  /**
   * The multi-choice answers on a round (residence environments, assistance
   * measures) arrive as `json_agg` arrays — already ordered and labelled, so the
   * response only has to drop anything malformed.
   */
  private mapCodeLabelList(value: unknown): Array<{ code: string; label: string }> {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (typeof entry !== 'object' || entry === null) return [];
      const record = entry as Record<string, unknown>;
      const code = this.normalizeText(record.code);
      const label = this.normalizeText(record.label);
      return code ? [{ code, label: label || code }] : [];
    });
  }

  private mapFollowUpRound(row: Record<string, unknown>) {
    const photoPaths = Array.isArray(row.photo_paths)
      ? JSON.stringify(row.photo_paths.filter((path): path is string => typeof path === 'string'))
      : this.normalizeText(row.photo_paths) || null;
    return {
      task_id: this.normalizeText(row.task_id),
      task_status: this.normalizeText(row.task_status),
      task_type: this.normalizeText(row.task_type) || null,
      assistance_measures: this.mapCodeLabelList(row.assistance_measures),
      assistance_measure_detail: this.normalizeText(row.assistance_measure_detail) || null,
      assisted_at: row.assisted_at ?? null,
      assistance_detail: this.normalizeText(row.assistance_detail) || null,
      created_at: row.created_at ?? null,
      initial_assignee: this.normalizeText(row.initial_assignee) || null,
      assignment_starts_at: row.assignment_starts_at ?? null,
      assignment_ends_at: row.assignment_ends_at ?? null,
      assignment_note: this.normalizeText(row.assignment_note) || null,
      link_count: this.normalizeNumber(row.link_count) ?? 0,
      link_status: this.normalizeText(row.link_status) || null,
      cancelled_at: row.cancelled_at ?? null,
      cancel_reason: this.normalizeText(row.cancel_reason) || null,
      cancelled_by_label: this.normalizeText(row.cancelled_by_label) || null,
      submitted_at: row.submitted_at ?? null,
      visited_at: row.visited_at ?? null,
      follow_up_problem_category_code:
        this.normalizeText(row.follow_up_problem_category_code) || null,
      follow_up_problem_category_label:
        this.normalizeText(row.follow_up_problem_category_label) || null,
      follow_up_problem_category_guidance:
        this.normalizeText(row.follow_up_problem_category_guidance) || null,
      parental_status_code: this.normalizeText(row.parental_status_code) || null,
      parental_status_label: this.normalizeText(row.parental_status_label) || null,
      guardian_type_code: this.normalizeText(row.guardian_type_code) || null,
      guardian_type_label: this.normalizeText(row.guardian_type_label) || null,
      guardian_type_detail: this.normalizeText(row.guardian_type_detail) || null,
      residence_environments: this.mapCodeLabelList(row.residence_environments),
      residence_environment_detail: this.normalizeText(row.residence_environment_detail) || null,
      cause_detail: this.normalizeText(row.cause_detail) || null,
      recommendation: this.normalizeText(row.recommendation) || null,
      visit_lat: row.visit_lat ?? null,
      visit_lng: row.visit_lng ?? null,
      photo_paths: photoPaths,
      address_changed: row.address_changed === true,
      home_visit_exception_code: this.normalizeText(row.home_visit_exception_code) || null,
      updated_student_address: this.normalizeText(row.updated_student_address) || null,
      updated_address_line: this.normalizeText(row.updated_address_line) || null,
      updated_address_province: this.normalizeText(row.updated_address_province) || null,
      updated_address_district: this.normalizeText(row.updated_address_district) || null,
      updated_address_sub_district: this.normalizeText(row.updated_address_sub_district) || null,
      updated_postal_code: this.normalizeText(row.updated_postal_code) || null,
      updated_lat: row.updated_lat ?? null,
      updated_lng: row.updated_lng ?? null,
      follow_up_decision: this.normalizeText(row.case_follow_up_decision) || null,
      resolution_outcome: this.normalizeText(row.case_resolution_outcome_code) || null,
    };
  }

  private mapCaseReview(row: Record<string, unknown>) {
    return {
      id: this.normalizeText(row.id),
      review_action: this.normalizeText(row.review_action),
      review_note: this.normalizeText(row.review_note) || null,
      review_summary: this.normalizeText(row.review_summary) || null,
      resolution_outcome: this.normalizeText(row.resolution_outcome) || null,
      reviewed_by:
        this.normalizeText(row.reviewer_display) || this.normalizeText(row.reviewed_by) || null,
      reviewed_at: row.reviewed_at ?? null,
    };
  }

  private mapCaseRiskSignal(row: Record<string, unknown>) {
    return {
      id: this.normalizeText(row.id),
      source_code: this.normalizeText(row.signal_source_code),
      rule_code: this.normalizeText(row.signal_rule_code) || null,
      reason: this.normalizeText(row.signal_reason),
      detected_at: row.detected_at ?? null,
    };
  }

  async openCase(body: OpenCaseDto, actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (
      isRestrictedExecutive(currentActor) ||
      !this.taskPolicyService.hasPermission(currentActor, 'dashboard')
    ) {
      throw new ForbiddenException('ไม่มีสิทธิ์เปิดเคสนักเรียน');
    }

    const studentUuid = this.normalizeText(body.student_id);
    const reason = clean(this.normalizeText(body.reason));
    if (!studentUuid || !reason) {
      throw new BadRequestException('student_id and reason are required');
    }

    const result = await this.taskRepository.withTransaction(async (executor) => {
      const student = await this.taskRepository.findStudentForCaseCreation(
        studentUuid,
        currentActor,
        executor,
      );
      if (!student) {
        throw new NotFoundException('Student not found');
      }

      const existingCase = await this.taskRepository.findActiveCaseByStudentUuid(
        studentUuid,
        currentActor,
        executor,
      );
      const existingCaseId = this.normalizeNumber(existingCase?.id);
      if (existingCaseId !== null) {
        return { caseId: existingCaseId, created: false, student };
      }

      const firstName = clean(this.normalizeText(student.FirstName_Onec)) || null;
      const lastName = clean(this.normalizeText(student.LastName_Onec)) || null;
      const studentName = [firstName, lastName].filter(Boolean).join(' ').trim();
      if (!studentName) {
        throw new BadRequestException('Student name is missing');
      }

      const schoolId = this.normalizeNumber(student.school_id);
      const caseId = await this.taskRepository.createCase(
        {
          studentName,
          studentFirstName: firstName,
          studentLastName: lastName,
          studentSchool: clean(this.normalizeText(student.school_name)) || null,
          studentAddress: buildStudentTermAddress(student),
          addressLine: clean(this.normalizeText(student.address_house_no)) || null,
          addressProvince: clean(this.normalizeText(student.ProvinceNameThai_Onec)) || null,
          addressDistrict: clean(this.normalizeText(student.DistrictNameThai_Onec)) || null,
          addressSubDistrict: clean(this.normalizeText(student.SubDistrictNameThai_Onec)) || null,
          postalCode: clean(this.normalizeText(student.PostalCode_Onec)) || null,
          studentLat: this.normalizeCoordinate(student.address_latitude),
          studentLng: this.normalizeCoordinate(student.address_longitude),
          reasonFlagged: reason,
          studentUuid,
          schoolId,
          createdBy: resolveAuditActorId(currentActor),
        },
        executor,
      );
      return { caseId, created: true, student };
    });

    const detail = await this.taskRepository.findCaseDetailById(result.caseId, currentActor);
    if (!detail) {
      throw new NotFoundException('Case not found');
    }

    if (result.created) {
      const mapped = this.mapCaseDetail(
        detail,
        this.taskPolicyService.hasPermission(currentActor, 'students'),
      );
      await this.auditLog.record({
        actorUserId: resolveAuditActorId(currentActor),
        actorLabel: this.actorLabel(currentActor),
        action: 'CASE_CREATE',
        targetType: 'case',
        targetId: String(result.caseId),
        metadata: { schoolId: mapped.school_id },
        ip: null,
      });
      await this.notificationsService.notifyCaseStatusChanged({
        caseId: result.caseId,
        studentName: mapped.student_name || null,
        schoolId: mapped.school_id,
        nextStatus: 'OPEN',
        actorUserId: resolveAuditActorId(currentActor),
      });
      await this.riskProfileService
        ?.requestStudentRecalculation([studentUuid], 'case-open')
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to recalculate opened case risk profile: ${message}`);
        });
    }

    return {
      success: true,
      created: result.created,
      data: this.mapCaseDetail(
        detail,
        this.taskPolicyService.hasPermission(currentActor, 'students'),
      ),
    };
  }

  async getCase(caseId: number, actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (isRestrictedExecutive(currentActor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ผ่านการปกปิดข้อมูล');
    }
    const detail = await this.taskRepository.findCaseDetailById(caseId, currentActor);
    if (!detail) {
      throw new NotFoundException('Case not found');
    }
    const [rounds, reviews, riskSignals] = await Promise.all([
      this.taskRepository.listTasksByCase(caseId),
      this.taskRepository.listCaseReviews(caseId),
      this.taskRepository.listCaseRiskSignals(caseId),
    ]);
    return {
      success: true,
      data: {
        ...this.mapCaseDetail(
          detail,
          this.taskPolicyService.hasPermission(currentActor, 'students'),
        ),
        follow_up_rounds: rounds.map((round) => this.mapFollowUpRound(round)),
        reviews: reviews.map((review) => this.mapCaseReview(review)),
        risk_signals: riskSignals.map((signal) => this.mapCaseRiskSignal(signal)),
      },
    };
  }

  /**
   * Withdraws the assignment a case is waiting on and sends the case back to
   * รอมอบหมาย. Only "รอติดตาม" with nothing reported yet can be withdrawn —
   * once a report is in, the round is history and the review path owns it.
   */
  async cancelCaseAssignment(
    caseId: number,
    body: CancelCaseAssignmentDto,
    actor?: AuthenticatedRequestUser,
  ) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (isRestrictedExecutive(currentActor)) {
      throw new ForbiddenException('บัญชีผู้บริหารไม่มีสิทธิ์ดำเนินการกับเคสรายบุคคล');
    }
    const reason = clean(this.normalizeText(body.cancel_reason)) || null;
    if (!reason) {
      throw new BadRequestException('กรุณาระบุเหตุผลการยกเลิกการมอบหมาย');
    }
    const caseRecord = await this.taskRepository.findCaseById(caseId, undefined, currentActor);
    if (!caseRecord) {
      throw new NotFoundException('Case not found');
    }
    const cancelled = await this.taskRepository.cancelCaseAssignment(
      caseId,
      reason,
      resolveAuditActorId(currentActor),
      currentActor,
    );
    if (!cancelled) {
      throw new BadRequestException('ยกเลิกได้เฉพาะการมอบหมายที่ยังไม่มีการส่งรายงาน');
    }
    await this.auditLog.record({
      actorUserId: resolveAuditActorId(currentActor),
      actorLabel: this.actorLabel(currentActor),
      action: 'TASK_CANCEL',
      targetType: 'task',
      targetId: cancelled.taskId,
      metadata: { caseId, taskType: cancelled.taskType, assignee: cancelled.assignee },
      ip: null,
    });
    return { success: true, data: { case_id: caseId, task_id: cancelled.taskId } };
  }

  async reviewCase(caseId: number, body: ReviewCaseDto, actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (isRestrictedExecutive(currentActor)) {
      throw new ForbiddenException('บัญชีผู้บริหารไม่มีสิทธิ์ดำเนินการกับเคสรายบุคคล');
    }
    const reviewActionCode = this.normalizeText(body.review_action).toUpperCase();
    const reviewAction = await this.caseTrackingOptions.getReviewAction(reviewActionCode);
    this.assertCanReviewCaseAction(currentActor, reviewAction.requiredPermission);
    const reviewNote = clean(this.normalizeText(body.review_note)) || null;
    if (!reviewNote) {
      throw new BadRequestException('กรุณาระบุเหตุผลการพิจารณา');
    }
    const resolutionOutcome = await this.caseTrackingOptions.assertResolutionOutcome(
      this.normalizeText(body.resolution_outcome).toUpperCase() || null,
    );
    if (reviewAction.requiresResolutionOutcome && !resolutionOutcome) {
      throw new BadRequestException('resolution_outcome is required for CLOSE');
    }
    const actorName = [actor?.FirstName, actor?.LastName].filter(Boolean).join(' ').trim();
    const reviewedBy = actorName || actor?.username || 'ผอ.';
    if (!reviewAction.targetStatus) {
      throw new BadRequestException('การดำเนินการนี้ไม่มีสถานะปลายทาง');
    }
    const nextStatus = reviewAction.targetStatus;
    const reviewId = crypto.randomUUID();

    try {
      const caseRecord = await this.taskRepository.findCaseById(caseId, undefined, currentActor);
      if (!caseRecord) {
        throw new Error('Case not found');
      }
      // An action pinned to a phase (ASSIST → FOLLOW_UP) must not be reachable
      // from another phase, otherwise an assistance case could be sent into a
      // second assistance round from the API even though the UI hides the button.
      const currentPhase = this.normalizeText(caseRecord.workflow_phase_code) || 'FOLLOW_UP';
      if (reviewAction.availablePhaseCode && reviewAction.availablePhaseCode !== currentPhase) {
        throw new BadRequestException('การดำเนินการนี้ใช้กับขั้นตอนปัจจุบันของเคสไม่ได้');
      }
      await this.taskRepository.withTransaction(async (executor) => {
        const transitioned = await this.taskRepository.transitionPendingReviewCase(
          caseId,
          nextStatus,
          reviewAction.completionOutcomeCode,
          executor,
          currentActor,
          reviewAction.targetWorkflowPhaseCode,
        );
        if (!transitioned) {
          throw new BadRequestException('เคสนี้ไม่ได้อยู่ในสถานะรอตรวจผลแล้ว');
        }
        await this.taskRepository.insertCaseReview(
          {
            reviewId,
            caseId,
            reviewAction: reviewAction.code,
            reviewNote,
            reviewSummary: null,
            resolutionOutcome: reviewAction.requiresResolutionOutcome ? resolutionOutcome : null,
            reviewedBy,
            sourceActorUserId: resolveAuditActorId(actor),
          },
          executor,
        );
      });

      const reviewRecord = await this.taskRepository.findCaseReviewById(reviewId);
      await this.auditLog.record({
        actorUserId: resolveAuditActorId(actor),
        actorLabel: this.actorLabel(actor),
        action:
          reviewAction.code === 'CLOSE'
            ? 'CASE_CLOSE'
            : reviewAction.code === 'REFER_AGENCY'
              ? 'CASE_REFER_AGENCY'
              : reviewAction.code === 'ASSIST'
                ? 'CASE_ASSIST'
                : 'CASE_REVIEW',
        targetType: 'case',
        targetId: String(caseId),
        metadata: {
          reviewAction: reviewAction.code,
          completionOutcome: reviewAction.completionOutcomeCode,
          targetWorkflowPhase: reviewAction.targetWorkflowPhaseCode,
          resolutionOutcome: reviewAction.requiresResolutionOutcome ? resolutionOutcome : null,
        },
        ip: null,
      });

      try {
        await this.notificationsService.notifyCaseStatusChanged({
          caseId,
          studentName: this.normalizeText(caseRecord.student_name) || null,
          schoolId: this.normalizeNumber(caseRecord.school_id),
          nextStatus,
          completionOutcomeCode: reviewAction.completionOutcomeCode,
          actorUserId: resolveAuditActorId(actor),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to notify reviewed case after commit: ${message}`);
      }
      const riskProfileStudentUuid =
        typeof caseRecord.student_uuid === 'string'
          ? this.normalizeText(caseRecord.student_uuid) || null
          : null;
      if (riskProfileStudentUuid) {
        await this.riskProfileService
          ?.requestStudentRecalculation([riskProfileStudentUuid], 'case-review')
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Failed to enqueue case review risk profile recalculation: ${message}`,
            );
          });
      }

      return {
        success: true,
        case_id: caseId,
        case_status: nextStatus,
        completion_outcome_code: reviewAction.completionOutcomeCode,
        review: reviewRecord || null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`reviewCase error: ${message}`);
      throw err;
    }
  }

  async getTasksByCase(caseId: number, actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (isRestrictedExecutive(currentActor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ผ่านการปกปิดข้อมูล');
    }
    try {
      const caseRecord = await this.taskRepository.findCaseById(caseId, undefined, currentActor);
      if (!caseRecord) {
        throw new Error('Case not found');
      }

      return {
        success: true,
        data: await this.taskRepository.listTasksByCase(caseId),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getTasksByCase error: ${message}`);
      throw err;
    }
  }

  async getCaseReviews(caseId: number, actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (isRestrictedExecutive(currentActor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ผ่านการปกปิดข้อมูล');
    }
    try {
      const caseRecord = await this.taskRepository.findCaseById(caseId, undefined, currentActor);
      if (!caseRecord) {
        throw new Error('Case not found');
      }

      return {
        success: true,
        data: await this.taskRepository.listCaseReviews(caseId),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getCaseReviews error: ${message}`);
      throw err;
    }
  }
}
