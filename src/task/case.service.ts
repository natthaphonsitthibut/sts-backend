import { Injectable, Logger } from '@nestjs/common';
import { clean } from '../common/utils/helpers';
import * as crypto from 'crypto';
import { ReviewCaseDto } from './dto/task.dto';
import { TaskRepository } from './task.repository';

type ReviewAction = 'ASSIST' | 'FORWARD' | 'CLOSE';

@Injectable()
export class CaseService {
  private readonly logger = new Logger(CaseService.name);

  constructor(private readonly taskRepository: TaskRepository) {}

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

  async reviewCase(caseId: number, body: ReviewCaseDto) {
    const reviewAction = this.normalizeAction(body.review_action);
    const reviewNote = clean(this.normalizeText(body.review_note)) || null;
    const reviewedBy = clean(this.normalizeText(body.reviewed_by)) || 'ผอ.';
    const nextStatus = this.getCaseStatusByAction(reviewAction);
    const reviewId = crypto.randomUUID();

    try {
      const caseRecord = await this.taskRepository.findCaseById(caseId);
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
        await this.taskRepository.updateCaseStatus(caseId, nextStatus, executor);
      });

      const reviewRecord = await this.taskRepository.findCaseReviewById(reviewId);

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

  async getTasksByCase(caseId: number) {
    try {
      const caseRecord = await this.taskRepository.findCaseById(caseId);
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

  async getCaseReviews(caseId: number) {
    try {
      const caseRecord = await this.taskRepository.findCaseById(caseId);
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
