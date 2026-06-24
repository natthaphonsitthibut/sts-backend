import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { clean } from '../common/utils/helpers';
import type { AuthenticatedRequestUser } from '../auth';
import * as crypto from 'crypto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { ReviewCaseDto } from './dto/task.dto';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';

type ReviewAction = 'ASSIST' | 'FORWARD' | 'CLOSE';

@Injectable()
export class CaseService {
  private readonly logger = new Logger(CaseService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
    private readonly auditLog: AuditLogService,
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

  private actorLabel(actor?: AuthenticatedRequestUser): string | null {
    const actorName = [actor?.FirstName, actor?.LastName].filter(Boolean).join(' ').trim();
    return actor?.username || actorName || null;
  }

  async reviewCase(caseId: number, body: ReviewCaseDto, actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    const reviewAction = this.normalizeAction(body.review_action);
    this.assertCanReviewCaseAction(currentActor, reviewAction);
    const reviewNote = clean(this.normalizeText(body.review_note)) || null;
    const referralNote = clean(this.normalizeText(body.referral_note)) || reviewNote;
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
            referralId: referralRecord?.id ?? null,
            agencyId: referralRecord?.agency_id ?? null,
          },
          ip: null,
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
}
