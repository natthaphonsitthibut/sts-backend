import {
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { isRestrictedExecutive } from '../auth/permissions.constants';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { MESSAGING_PROVIDER, type MessagingProvider } from '../common/messaging/messaging.types';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository, type RoundLineNotReadyCode } from './task.repository';

export type RoundLineStatus = 'NOT_READY' | 'SENDING' | 'SENT' | 'FAILED' | 'NEEDS_RESEND';

/**
 * Sends an assignment round's link straight to its teacher over the school
 * system's LINE account — the case page's "ส่งลิงก์ผ่าน LINE", the same one
 * the teacher-link page has (owner, 2026-09-25). Only a teacher who verified
 * LINE and still has the account added can receive it.
 */
@Injectable()
export class CaseRoundLineService {
  private readonly logger = new Logger(CaseRoundLineService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
    private readonly auditLog: AuditLogService,
    @Inject(MESSAGING_PROVIDER) private readonly messaging: MessagingProvider,
  ) {}

  isEnabled(): boolean {
    return this.messaging.isEnabled();
  }

  async send(
    caseId: number,
    taskId: string,
    deliveryRequestId: string,
    actor?: AuthenticatedRequestUser,
  ): Promise<{ success: true; data: { status: RoundLineStatus; failure_code: string | null } }> {
    const currentActor = this.taskPolicyService.ensureActor(actor);
    if (isRestrictedExecutive(currentActor)) {
      throw new ForbiddenException('บัญชีผู้บริหารไม่มีสิทธิ์ดำเนินการกับเคสรายบุคคล');
    }
    // Same scope gate as every other case action.
    const caseRecord = await this.taskRepository.findCaseById(caseId, undefined, currentActor);
    if (!caseRecord) throw new NotFoundException('Case not found');

    const link = await this.taskRepository.findRoundLinkForLine(caseId, taskId);
    if (!link) throw new GoneException('ลิงก์มอบหมายนี้ปิดแล้ว');
    const actorId = resolveAuditActorId(currentActor);

    let notReady: RoundLineNotReadyCode | null = null;
    if (!link.assigned_teacher_id) notReady = 'ASSIGNEE_UNAVAILABLE';
    else if (!this.messaging.isEnabled()) notReady = 'MESSAGING_DISABLED';
    else if (!link.line_provider_user_id) notReady = 'ACCOUNT_NOT_VERIFIED';
    else if (link.line_friend_state !== 'FRIEND') notReady = 'ACCOUNT_NOT_REACHABLE';
    if (notReady || !link.magic_link) {
      const code = notReady ?? 'ASSIGNEE_UNAVAILABLE';
      await this.taskRepository.recordRoundLineNotReady(
        link.id,
        link.assigned_teacher_id,
        code,
        actorId,
      );
      return { success: true, data: { status: 'NOT_READY', failure_code: code } };
    }

    const claimed = await this.taskRepository.claimRoundLine(
      link.id,
      link.assigned_teacher_id!,
      deliveryRequestId,
      actorId,
    );
    // Someone else's send (or this one, retried) is already in flight.
    if (!claimed) return { success: true, data: { status: 'SENDING', failure_code: null } };

    const deadline = new Date(link.expires_at).toLocaleString('th-TH', {
      timeZone: BANGKOK_TIME_ZONE,
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const work = link.task_type === 'ASSIST' ? 'ให้ความช่วยเหลือ' : 'ติดตาม';
    const text = [
      `ได้รับมอบหมาย${work}นักเรียน ${link.student_name ?? '-'}`,
      link.student_school ? `(${link.student_school})` : null,
      `ภายใน ${deadline}`,
      `กดลิงก์เพื่อบันทึกผล: ${link.magic_link}`,
    ]
      .filter(Boolean)
      .join('\n');

    let delivered = false;
    try {
      const [result] = await this.messaging.sendMessages(
        [{ providerUserId: link.line_provider_user_id!, text }],
        `case-round-${deliveryRequestId}`,
      );
      delivered = result?.delivered === true;
    } catch {
      this.logger.warn('LINE delivery failed for a case assignment round');
    }
    await this.taskRepository.finishRoundLine(link.id, deliveryRequestId, delivered, actorId);
    await this.auditLog.record({
      actorUserId: actorId,
      actorLabel: currentActor.username ?? null,
      action: 'TASK_LINK_LINE_SEND',
      targetType: 'task',
      targetId: link.task_id,
      metadata: { caseId, delivered },
      ip: null,
    });
    return {
      success: true,
      data: {
        status: delivered ? 'SENT' : 'FAILED',
        failure_code: delivered ? null : 'PROVIDER_UNAVAILABLE',
      },
    };
  }
}
