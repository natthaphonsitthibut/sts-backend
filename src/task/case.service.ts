import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { clean } from '../common/utils/helpers';
import type { AuthenticatedRequestUser } from '../auth';
import * as crypto from 'crypto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import {
  ReviewCaseDto,
  type CaseReferralOutcomeStatus,
  type CaseResolutionOutcome,
} from './dto/task.dto';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';

type ReviewAction = 'ASSIST' | 'FORWARD' | 'CLOSE';
const CASE_REFERRAL_OUTCOME_STATUSES: CaseReferralOutcomeStatus[] = [
  'ACKNOWLEDGED',
  'ACCEPTED',
  'DECLINED',
  'RETURNED',
];
const CASE_RESOLUTION_OUTCOMES: CaseResolutionOutcome[] = [
  'RETURNED_TO_SCHOOL',
  'TRANSFERRED_SCHOOL',
  'ILLNESS',
  'WORKING',
  'UNREACHABLE',
  'REFERRED_EXTERNAL',
  'OTHER',
];
const CASE_SLA_REMINDER_CRON = '0 45 4 * * *';

@Injectable()
export class CaseService {
  private readonly logger = new Logger(CaseService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
    private readonly auditLog: AuditLogService,
    private readonly notificationsService: NotificationsService,
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

  private normalizeAction(action: unknown): ReviewAction {
    const normalized = this.normalizeText(action).toUpperCase();
    if (normalized === 'ASSIST') return 'ASSIST';
    if (normalized === 'FORWARD') return 'FORWARD';
    if (normalized === 'CLOSE') return 'CLOSE';
    throw new Error('review_action must be one of: ASSIST, FORWARD, CLOSE');
  }

  private normalizeReferralOutcomeStatus(status: unknown): CaseReferralOutcomeStatus {
    const normalized = this.normalizeText(status).toUpperCase();
    if (CASE_REFERRAL_OUTCOME_STATUSES.includes(normalized as CaseReferralOutcomeStatus)) {
      return normalized as CaseReferralOutcomeStatus;
    }
    throw new Error('status must be one of: ACKNOWLEDGED, ACCEPTED, DECLINED, RETURNED');
  }

  private normalizeResolutionOutcome(value: unknown): CaseResolutionOutcome | null {
    const normalized = this.normalizeText(value).toUpperCase();
    if (!normalized) {
      return null;
    }
    if (CASE_RESOLUTION_OUTCOMES.includes(normalized as CaseResolutionOutcome)) {
      return normalized as CaseResolutionOutcome;
    }
    throw new BadRequestException('resolution_outcome is invalid');
  }

  private getCaseStatusByAction(action: ReviewAction): string {
    if (action === 'CLOSE') return 'RESOLVED';
    if (action === 'FORWARD') return 'AWAITING_HELP';
    return 'IN_PROGRESS'; // ASSIST — วนกลับเข้ากระบวนการติดตามใหม่
  }

  private assertCanReviewCaseAction(actor: AuthenticatedRequestUser, action: ReviewAction): void {
    if (!this.taskPolicyService.hasPermission(actor, 'review-cases')) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับเคสนี้');
    }

    const requiredPermission =
      action === 'CLOSE' ? 'close-case' : action === 'FORWARD' ? 'forward-case' : 'review-cases';

    if (!this.taskPolicyService.hasPermission(actor, requiredPermission)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับเคสนี้');
    }
  }

  private assertCanUpdateReferralOutcome(actor: AuthenticatedRequestUser): void {
    if (
      !this.taskPolicyService.hasPermission(actor, 'review-cases') ||
      !this.taskPolicyService.hasPermission(actor, 'forward-case')
    ) {
      throw new ForbiddenException('ไม่มีสิทธิ์อัปเดตผลการส่งต่อเคสนี้');
    }
  }

  private actorLabel(actor?: AuthenticatedRequestUser): string | null {
    const actorName = [actor?.FirstName, actor?.LastName].filter(Boolean).join(' ').trim();
    return actor?.username || actorName || null;
  }

  async remindCaseSla(now = new Date()): Promise<{ warned: number; breached: number }> {
    const warnings = await this.taskRepository.claimCaseSlaWarnings(now);
    const breaches = await this.taskRepository.claimCaseSlaBreaches(now);

    for (const row of warnings) {
      await this.notificationsService.notifyCaseSlaWarning({
        caseId: row.id,
        studentName: row.student_name,
        schoolId: row.school_id,
        riskTier: row.risk_tier,
        dueAt: row.sla_due_at,
      });
    }

    for (const row of breaches) {
      await this.notificationsService.notifyCaseSlaBreached({
        caseId: row.id,
        studentName: row.student_name,
        schoolId: row.school_id,
        riskTier: row.risk_tier,
        dueAt: row.sla_due_at,
      });
    }

    if (warnings.length > 0 || breaches.length > 0) {
      this.logger.log(
        `Sent ${warnings.length} case SLA warning(s) and ${breaches.length} breach escalation(s).`,
      );
    }

    return { warned: warnings.length, breached: breaches.length };
  }

  @Cron(CASE_SLA_REMINDER_CRON, {
    timeZone: BANGKOK_TIME_ZONE,
    name: 'case_sla_reminder',
  })
  async runCaseSlaReminder(): Promise<void> {
    try {
      await this.remindCaseSla();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Case SLA reminder job failed: ${message}`);
    }
  }

  async reviewCase(caseId: number, body: ReviewCaseDto, actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    const reviewAction = this.normalizeAction(body.review_action);
    this.assertCanReviewCaseAction(currentActor, reviewAction);
    const reviewNote = clean(this.normalizeText(body.review_note)) || null;
    const referralNote = clean(this.normalizeText(body.referral_note)) || reviewNote;
    const resolutionOutcome = this.normalizeResolutionOutcome(body.resolution_outcome);
    if (reviewAction === 'CLOSE' && !resolutionOutcome) {
      throw new BadRequestException('resolution_outcome is required for CLOSE');
    }
    const agencyId = this.normalizeNumber(body.agency_id);
    const actorName = [actor?.FirstName, actor?.LastName].filter(Boolean).join(' ').trim();
    const reviewedBy = actorName || actor?.username || 'ผอ.';
    const nextStatus = this.getCaseStatusByAction(reviewAction);
    const reviewId = crypto.randomUUID();
    const referralId = crypto.randomUUID();

    try {
      const caseRecord = await this.taskRepository.findCaseById(caseId, undefined, currentActor);
      if (!caseRecord) {
        throw new Error('Case not found');
      }
      if (reviewAction === 'FORWARD' && agencyId === null) {
        throw new Error('agency_id is required for FORWARD');
      }

      const referralAgency =
        reviewAction === 'FORWARD' && agencyId !== null
          ? await this.taskRepository.findEligibleReferralAgency(agencyId, caseId)
          : null;
      if (reviewAction === 'FORWARD' && !referralAgency) {
        throw new Error('Referral agency not found');
      }

      await this.taskRepository.withTransaction(async (executor) => {
        await this.taskRepository.insertCaseReview(
          {
            reviewId,
            caseId,
            reviewAction,
            reviewNote,
            resolutionOutcome: reviewAction === 'CLOSE' ? resolutionOutcome : null,
            reviewedBy,
          },
          executor,
        );
        if (reviewAction === 'FORWARD' && referralAgency) {
          await this.taskRepository.insertCaseReferral(
            {
              referralId,
              caseId,
              agencyId: Number(referralAgency.id),
              agencyName: String(referralAgency.name),
              agencyType: String(referralAgency.agency_type),
              referredBy: resolveAuditActorId(actor),
              referredByLabel: this.actorLabel(actor),
              referralNote,
              createdBy: resolveAuditActorId(actor),
            },
            executor,
          );
        }
        await this.taskRepository.updateCaseStatus(caseId, nextStatus, executor, currentActor);
      });

      const reviewRecord = await this.taskRepository.findCaseReviewById(reviewId);
      const referralRecord =
        reviewAction === 'FORWARD'
          ? (await this.taskRepository.listCaseReferrals(caseId)).find(
              (referral) => referral.id === referralId,
            ) || null
          : null;
      if (reviewAction === 'CLOSE' || reviewAction === 'FORWARD') {
        await this.auditLog.record({
          actorUserId: resolveAuditActorId(actor),
          actorLabel: this.actorLabel(actor),
          action: reviewAction === 'CLOSE' ? 'CASE_CLOSE' : 'CASE_FORWARD',
          targetType: 'case',
          targetId: String(caseId),
          metadata: {
            reviewAction,
            resolutionOutcome: reviewAction === 'CLOSE' ? resolutionOutcome : null,
            referralId: referralRecord?.id ?? null,
            agencyId: referralRecord?.agency_id ?? null,
          },
          ip: null,
        });
      }

      await this.notificationsService.notifyCaseStatusChanged({
        caseId,
        studentName: this.normalizeText(caseRecord.student_name) || null,
        schoolId: this.normalizeNumber(caseRecord.school_id),
        nextStatus,
        actorUserId: resolveAuditActorId(actor),
      });
      const riskProfileStudentUuid =
        typeof caseRecord.student_uuid === 'string'
          ? this.normalizeText(caseRecord.student_uuid) || null
          : null;
      if (riskProfileStudentUuid) {
        await this.riskProfileService
          ?.enqueueStudents([riskProfileStudentUuid], 'case-review')
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
        review: reviewRecord || null,
        referral: referralRecord || null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`reviewCase error: ${message}`);
      throw err;
    }
  }

  async getTasksByCase(caseId: number, actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
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

  async getReferralAgencies(caseId: number, actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    try {
      const caseRecord = await this.taskRepository.findCaseById(caseId, undefined, currentActor);
      if (!caseRecord) {
        throw new Error('Case not found');
      }

      return {
        success: true,
        data: await this.taskRepository.listReferralAgenciesForCase(caseId),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getReferralAgencies error: ${message}`);
      throw err;
    }
  }

  async getCaseReferrals(caseId: number, actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    try {
      const caseRecord = await this.taskRepository.findCaseById(caseId, undefined, currentActor);
      if (!caseRecord) {
        throw new Error('Case not found');
      }

      return {
        success: true,
        data: await this.taskRepository.listCaseReferrals(caseId),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getCaseReferrals error: ${message}`);
      throw err;
    }
  }

  async updateCaseReferralOutcome(
    caseId: number,
    referralId: string,
    body: { status?: unknown; outcome?: unknown },
    actor?: AuthenticatedRequestUser,
  ) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    this.assertCanUpdateReferralOutcome(currentActor);
    const status = this.normalizeReferralOutcomeStatus(body.status);
    const outcome = clean(this.normalizeText(body.outcome)) || null;

    try {
      const referral = await this.taskRepository.findCaseReferralById(referralId, currentActor);
      if (!referral || Number(referral.case_id) !== caseId) {
        throw new Error('Referral not found');
      }

      const savedReferral = await this.taskRepository.updateCaseReferralOutcome({
        referralId,
        status,
        outcome,
        updatedBy: resolveAuditActorId(actor),
      });
      if (!savedReferral) {
        throw new Error('Referral not found');
      }

      const updatedReferral =
        (await this.taskRepository.listCaseReferrals(caseId)).find(
          (item) => item.id === referralId,
        ) || null;

      await this.auditLog.record({
        actorUserId: resolveAuditActorId(actor),
        actorLabel: this.actorLabel(actor),
        action: 'CASE_REFERRAL_OUTCOME_UPDATE',
        targetType: 'case_referral',
        targetId: referralId,
        metadata: {
          caseId,
          status,
        },
        ip: null,
      });

      return {
        success: true,
        data: updatedReferral,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`updateCaseReferralOutcome error: ${message}`);
      throw err;
    }
  }
}
