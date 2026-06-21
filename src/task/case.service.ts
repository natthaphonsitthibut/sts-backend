import { Injectable, Logger } from '@nestjs/common';
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

  private actorLabel(actor?: AuthenticatedRequestUser): string | null {
    const actorName = [actor?.FirstName, actor?.LastName].filter(Boolean).join(' ').trim();
    return actor?.username || actorName || null;
  }

  async reviewCase(caseId: number, body: ReviewCaseDto, actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    const reviewAction = this.normalizeAction(body.review_action);
    const reviewNote = clean(this.normalizeText(body.review_note)) || null;
    const actorName = [actor?.FirstName, actor?.LastName].filter(Boolean).join(' ').trim();
    const reviewedBy = actorName || actor?.username || 'ผอ.';
    const nextStatus = this.getCaseStatusByAction(reviewAction);
    const reviewId = crypto.randomUUID();

    try {
      const caseRecord = await this.taskRepository.findCaseById(caseId, undefined, currentActor);
      if (!caseRecord) {
        throw new Error('Case not found');
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
        await this.taskRepository.updateCaseStatus(caseId, nextStatus, executor, currentActor);
      });

      const reviewRecord = await this.taskRepository.findCaseReviewById(reviewId);
      if (reviewAction === 'CLOSE' || reviewAction === 'FORWARD') {
        await this.auditLog.record({
          actorUserId: resolveAuditActorId(actor),
          actorLabel: this.actorLabel(actor),
          action: reviewAction === 'CLOSE' ? 'CASE_CLOSE' : 'CASE_FORWARD',
          targetType: 'case',
          targetId: String(caseId),
          metadata: { reviewAction },
          ip: null,
        });
      }

      return {
        success: true,
        case_id: caseId,
        case_status: nextStatus,
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
}
