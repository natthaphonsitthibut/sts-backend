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
import { TaskRepository, type CaseScopeContext } from './task.repository';

/**
 * Who is opening a case: an account, or a teacher reached through a classroom
 * link (no account, identified by their `teachers` row). Both write the same
 * case; only the identity recorded on it and the scope it is checked against
 * differ.
 */
type CaseOpener = {
  scope: CaseScopeContext;
  auditActorId: number | null;
  label: string | null;
  canReadStudentIdentity: boolean;
} & ({ kind: 'USER'; teacherId?: never } | { kind: 'LINK_TEACHER'; teacherId: string });

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
      task_execution_outcome_code: this.normalizeText(row.task_execution_outcome_code) || null,
      task_execution_outcome_label: this.normalizeText(row.task_execution_outcome_label) || null,
      execution_outcome_detail: this.normalizeText(row.execution_outcome_detail) || null,
      non_follow_up_reason_code: this.normalizeText(row.non_follow_up_reason_code) || null,
      non_follow_up_reason_label: this.normalizeText(row.non_follow_up_reason_label) || null,
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
      absence_reason_code: this.normalizeText(row.absence_reason_code) || null,
      absence_reason_label: this.normalizeText(row.absence_reason_label) || null,
      absence_reason_category_label: this.normalizeText(row.absence_reason_category_label) || null,
      parental_status_code: this.normalizeText(row.parental_status_code) || null,
      parental_status_label: this.normalizeText(row.parental_status_label) || null,
      guardian_type_code: this.normalizeText(row.guardian_type_code) || null,
      guardian_type_label: this.normalizeText(row.guardian_type_label) || null,
      guardian_type_detail: this.normalizeText(row.guardian_type_detail) || null,
      contact_person_name: this.normalizeText(row.contact_person_name) || null,
      contact_channel_code: this.normalizeText(row.contact_channel_code) || null,
      contact_channel_label: this.normalizeText(row.contact_channel_label) || null,
      residence_environments: this.mapCodeLabelList(row.residence_environments),
      residence_environment_detail: this.normalizeText(row.residence_environment_detail) || null,
      observed_disadvantage_types: this.mapCodeLabelList(row.observed_disadvantage_types),
      observed_disability_types: this.mapCodeLabelList(row.observed_disability_types),
      cause_detail: this.normalizeText(row.cause_detail) || null,
      recommendation: this.normalizeText(row.recommendation) || null,
      visit_lat: row.visit_lat ?? null,
      visit_lng: row.visit_lng ?? null,
      photo_paths: photoPaths,
      address_changed: row.address_changed === true,
      home_visit_exception_code: this.normalizeText(row.home_visit_exception_code) || null,
      home_visit_exception_label: this.normalizeText(row.home_visit_exception_label) || null,
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
      proposed_assistance_measures: this.mapCodeLabelList(row.proposed_assistance_measures),
      proposed_assistance_measure_detail:
        this.normalizeText(row.proposed_assistance_measure_detail) || null,
      resolution_outcome: this.normalizeText(row.resolution_outcome) || null,
      reviewed_by:
        this.normalizeText(row.reviewer_display) || this.normalizeText(row.reviewed_by) || null,
      reviewed_at: row.reviewed_at ?? null,
    };
  }

  private mapCaseReferral(row: Record<string, unknown>) {
    return {
      id: this.normalizeText(row.id),
      case_review_id: this.normalizeText(row.case_review_id),
      referral_agency_id: this.normalizeNumber(row.referral_agency_id),
      agency_name: this.normalizeText(row.agency_name),
      agency_kind_code: this.normalizeText(row.agency_kind_code),
      agency_kind_label: this.normalizeText(row.agency_kind_label_th),
      status_code: this.normalizeText(row.status_code),
      referred_at: row.referred_at ?? null,
      referred_by: this.normalizeText(row.referred_by) || null,
      referral_note: this.normalizeText(row.referral_note) || null,
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

    return await this.createCaseForStudent(body, {
      kind: 'USER',
      scope: { id: currentActor.id, data_scope: currentActor.data_scope },
      auditActorId: resolveAuditActorId(currentActor),
      label: this.actorLabel(currentActor),
      canReadStudentIdentity: this.taskPolicyService.hasPermission(currentActor, 'students'),
    });
  }

  /**
   * The same case, opened by a teacher working from a classroom link.
   *
   * The caller has already proved the link session owns this student's
   * classroom — that is the boundary here, since there is no account to check a
   * permission against. The case records the teacher it was opened by, because
   * a link is never anonymous: they signed in with Google or AraID first.
   */
  async openCaseFromLink(
    body: OpenCaseDto,
    author: { schoolId: number; teacherId: string; displayName: string },
  ) {
    return await this.createCaseForStudent(body, {
      kind: 'LINK_TEACHER',
      scope: { data_scope: { school_ids: [author.schoolId] } },
      auditActorId: null,
      label: author.displayName,
      teacherId: author.teacherId,
      canReadStudentIdentity: false,
    });
  }

  private async createCaseForStudent(body: OpenCaseDto, opener: CaseOpener) {
    const studentUuid = this.normalizeText(body.student_id);
    const reason = clean(this.normalizeText(body.reason));
    if (!studentUuid || !reason) {
      throw new BadRequestException('student_id and reason are required');
    }

    const result = await this.taskRepository.withTransaction(async (executor) => {
      const student = await this.taskRepository.findStudentForCaseCreation(
        studentUuid,
        opener.scope,
        executor,
      );
      if (!student) {
        throw new NotFoundException('Student not found');
      }

      const existingCase = await this.taskRepository.findActiveCaseByStudentUuid(
        studentUuid,
        opener.scope,
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
          createdBy: opener.auditActorId,
          createdByTeacherId: opener.kind === 'LINK_TEACHER' ? opener.teacherId : null,
        },
        executor,
      );
      return { caseId, created: true, student };
    });

    const detail = await this.taskRepository.findCaseDetailById(result.caseId, opener.scope);
    if (!detail) {
      throw new NotFoundException('Case not found');
    }

    if (result.created) {
      const mapped = this.mapCaseDetail(detail, opener.canReadStudentIdentity);
      await this.auditLog.record({
        actorUserId: opener.auditActorId,
        actorLabel: opener.label,
        action: 'CASE_CREATE',
        targetType: 'case',
        targetId: String(result.caseId),
        metadata: {
          schoolId: mapped.school_id,
          ...(opener.kind === 'LINK_TEACHER' ? { openedByTeacherId: opener.teacherId } : {}),
        },
        ip: null,
      });
      await this.notificationsService.notifyCaseStatusChanged({
        caseId: result.caseId,
        studentName: mapped.student_name || null,
        schoolId: mapped.school_id,
        nextStatus: 'OPEN',
        actorUserId: opener.auditActorId,
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
      data: this.mapCaseDetail(detail, opener.canReadStudentIdentity),
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
    const [rounds, reviews, riskSignals, referrals] = await Promise.all([
      this.taskRepository.listTasksByCase(caseId),
      this.taskRepository.listCaseReviews(caseId),
      this.taskRepository.listCaseRiskSignals(caseId),
      this.taskRepository.listCaseReferrals(caseId),
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
        referrals: referrals.map((referral) => this.mapCaseReferral(referral)),
      },
    };
  }

  async listReferralAgencies(actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (
      isRestrictedExecutive(currentActor) ||
      !this.taskPolicyService.hasPermission(currentActor, 'dashboard')
    ) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดูหน่วยงานส่งต่อ');
    }
    const rows = await this.taskRepository.listActiveReferralAgencies();
    return {
      success: true,
      data: rows.map((row) => ({
        id: this.normalizeNumber(row.id),
        agencyName: this.normalizeText(row.agency_name),
        agencyKindCode: this.normalizeText(row.agency_kind_code),
        agencyKindLabel: this.normalizeText(row.agency_kind_label_th),
        contactPhone: this.normalizeText(row.contact_phone) || null,
        contactEmail: this.normalizeText(row.contact_email) || null,
        websiteUrl: this.normalizeText(row.website_url) || null,
      })),
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
    const referralAgencyId = this.normalizeNumber(body.referral_agency_id);
    if (reviewAction.code === 'REFER_AGENCY' && referralAgencyId === null) {
      throw new BadRequestException('กรุณาเลือกหน่วยงานส่งต่อ');
    }
    if (reviewAction.code !== 'REFER_AGENCY' && referralAgencyId !== null) {
      throw new BadRequestException('หน่วยงานส่งต่อใช้ได้เฉพาะการส่งต่อหน่วยงาน');
    }
    const proposedAssistanceMeasureDetail =
      clean(this.normalizeText(body.assistance_measure_detail)) || null;
    const proposedAssistanceMeasures =
      reviewAction.code === 'ASSIST'
        ? await this.caseTrackingOptions.getAssistanceMeasures(
            body.assistance_measure_codes ?? [],
            proposedAssistanceMeasureDetail,
          )
        : [];
    if (
      reviewAction.code !== 'ASSIST' &&
      ((body.assistance_measure_codes?.length ?? 0) > 0 || proposedAssistanceMeasureDetail)
    ) {
      throw new BadRequestException('มาตรการช่วยเหลือใช้ได้เฉพาะการมอบหมายช่วยเหลือ');
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
        const referralAgency =
          referralAgencyId === null
            ? null
            : await this.taskRepository.findActiveReferralAgency(referralAgencyId, executor);
        if (referralAgencyId !== null && !referralAgency) {
          throw new BadRequestException('หน่วยงานส่งต่อไม่ถูกต้องหรือถูกปิดใช้งาน');
        }
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
            proposedAssistanceMeasureDetail: proposedAssistanceMeasures.some(
              (measure) => measure.requiresDetail,
            )
              ? proposedAssistanceMeasureDetail
              : null,
          },
          executor,
        );
        await this.taskRepository.insertCaseReviewAssistanceMeasures(
          reviewId,
          proposedAssistanceMeasures.map((measure) => measure.code),
          executor,
        );
        if (referralAgencyId !== null) {
          await this.taskRepository.insertCaseReferral(
            {
              reviewId,
              caseId,
              agencyId: referralAgencyId,
              referredByUserId: resolveAuditActorId(actor),
              note: reviewNote,
            },
            executor,
          );
        }
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
          referralAgencyId,
          proposedAssistanceMeasureCodes: proposedAssistanceMeasures.map((measure) => measure.code),
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
