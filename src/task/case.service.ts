import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { clean } from '../common/utils/helpers';
import type { AuthenticatedRequestUser } from '../auth';
import { isAggregateOnlyExecutive } from '../auth/permissions.constants';
import * as crypto from 'crypto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { ReviewCaseDto, type CaseResolutionOutcome } from './dto/task.dto';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';

type ReviewAction = 'ASSIST' | 'CLOSE';
const CASE_RESOLUTION_OUTCOMES: CaseResolutionOutcome[] = [
  'RETURNED_TO_SCHOOL',
  'TRANSFERRED_SCHOOL',
  'ILLNESS',
  'WORKING',
  'UNREACHABLE',
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
    if (normalized === 'CLOSE') return 'CLOSE';
    throw new Error('review_action must be one of: ASSIST, CLOSE');
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
    return 'IN_PROGRESS'; // ASSIST — วนกลับเข้ากระบวนการติดตามใหม่
  }

  private assertCanReviewCaseAction(actor: AuthenticatedRequestUser, action: ReviewAction): void {
    if (!this.taskPolicyService.hasPermission(actor, 'review-cases')) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับเคสนี้');
    }

    const requiredPermission = action === 'CLOSE' ? 'close-case' : 'review-cases';

    if (!this.taskPolicyService.hasPermission(actor, requiredPermission)) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดำเนินการกับเคสนี้');
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
    if (isAggregateOnlyExecutive(currentActor)) {
      throw new ForbiddenException('บัญชีผู้บริหารไม่มีสิทธิ์ดำเนินการกับเคสรายบุคคล');
    }
    const reviewAction = this.normalizeAction(body.review_action);
    this.assertCanReviewCaseAction(currentActor, reviewAction);
    const reviewNote = clean(this.normalizeText(body.review_note)) || null;
    const resolutionOutcome = this.normalizeResolutionOutcome(body.resolution_outcome);
    if (reviewAction === 'CLOSE' && !resolutionOutcome) {
      throw new BadRequestException('resolution_outcome is required for CLOSE');
    }
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
            resolutionOutcome: reviewAction === 'CLOSE' ? resolutionOutcome : null,
            reviewedBy,
          },
          executor,
        );
        await this.taskRepository.updateCaseStatus(caseId, nextStatus, executor, currentActor);
      });

      const reviewRecord = await this.taskRepository.findCaseReviewById(reviewId);
      await this.auditLog.record({
        actorUserId: resolveAuditActorId(actor),
        actorLabel: this.actorLabel(actor),
        action: reviewAction === 'CLOSE' ? 'CASE_CLOSE' : 'CASE_REVIEW',
        targetType: 'case',
        targetId: String(caseId),
        metadata: {
          reviewAction,
          resolutionOutcome: reviewAction === 'CLOSE' ? resolutionOutcome : null,
        },
        ip: null,
      });

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
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`reviewCase error: ${message}`);
      throw err;
    }
  }

  async getTasksByCase(caseId: number, actor?: AuthenticatedRequestUser) {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (isAggregateOnlyExecutive(currentActor)) {
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
    if (isAggregateOnlyExecutive(currentActor)) {
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
