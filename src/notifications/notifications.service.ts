import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { maskName } from '../common/utils/helpers';
import { NotificationsRepository } from './notifications.repository';
import type { NotificationFanOutInput, NotificationListFilters } from './notifications.types';

const CASE_STATUS_LABELS: Record<string, string> = {
  OPEN: 'เปิดเคส',
  IN_PROGRESS: 'กำลังติดตาม',
  PENDING_REVIEW: 'รอพิจารณา',
  AWAITING_HELP: 'ส่งต่อหน่วยงาน',
  RESOLVED: 'ปิดเคสแล้ว',
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly notificationsRepository: NotificationsRepository) {}

  /**
   * Fan-out is best-effort by design: a notification failure must never break
   * the domain flow that triggered it (case write, delegation, submission).
   */
  private async fanOutSafely(input: NotificationFanOutInput): Promise<void> {
    try {
      const recipients = await this.notificationsRepository.fanOut(input);
      this.logger.log(`Notification ${input.typeCode} fanned out to ${recipients} recipient(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Notification fan-out failed for ${input.typeCode}: ${message}`);
    }
  }

  async notifyCaseCreated(event: {
    caseId: number;
    studentName: string | null;
    schoolId: number | null;
    schoolName: string | null;
    reason: string | null;
  }): Promise<void> {
    const student = event.studentName ? maskName(event.studentName) : 'นักเรียน';
    const bodyParts = [student, event.schoolName, event.reason].filter(Boolean);
    await this.fanOutSafely({
      typeCode: 'CASE_CREATED',
      title: 'มีเคสติดตามใหม่',
      body: bodyParts.join(' · '),
      refEntity: 'case',
      refId: String(event.caseId),
      schoolId: event.schoolId,
    });
  }

  async notifyCaseStatusChanged(event: {
    caseId: number;
    studentName: string | null;
    schoolId: number | null;
    nextStatus: string;
    actorUserId: number | null;
  }): Promise<void> {
    const statusLabel = CASE_STATUS_LABELS[event.nextStatus] ?? event.nextStatus;
    const student = event.studentName ? maskName(event.studentName) : 'นักเรียน';
    await this.fanOutSafely({
      typeCode: 'CASE_STATUS_CHANGED',
      title: `เคสเปลี่ยนสถานะ: ${statusLabel}`,
      body: `เคสของ ${student}`,
      refEntity: 'case',
      refId: String(event.caseId),
      schoolId: event.schoolId,
      excludeUserId: event.actorUserId,
    });
  }

  async notifyTaskDelegated(event: { taskId: string; assigneeName: string | null }): Promise<void> {
    const context = await this.findTaskContextSafely(event.taskId);
    const assignee = event.assigneeName ? maskName(event.assigneeName) : 'ผู้รับงานใหม่';
    await this.fanOutSafely({
      typeCode: 'TASK_DELEGATED',
      title: 'งานเยี่ยมบ้านถูกส่งต่อ',
      body: `ส่งต่อให้ ${assignee}`,
      refEntity: 'task',
      refId: event.taskId,
      schoolId: context?.target_school_id ?? null,
      gradeLevel: context?.target_grade ?? null,
      roomId: context?.target_room ?? null,
    });
  }

  async notifyTaskSubmitted(event: {
    taskId: string;
    submitterName: string | null;
  }): Promise<void> {
    const context = await this.findTaskContextSafely(event.taskId);
    const submitter = event.submitterName ? maskName(event.submitterName) : 'ผู้รับงาน';
    await this.fanOutSafely({
      typeCode: 'TASK_SUBMITTED',
      title: 'มีรายงานเยี่ยมบ้านส่งกลับ',
      body: `รายงานจาก ${submitter}`,
      refEntity: 'task',
      refId: event.taskId,
      schoolId: context?.target_school_id ?? null,
      gradeLevel: context?.target_grade ?? null,
      roomId: context?.target_room ?? null,
    });
  }

  private async findTaskContextSafely(taskId: string) {
    try {
      return await this.notificationsRepository.findTaskContext(taskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Notification task-context lookup failed for ${taskId}: ${message}`);
      return null;
    }
  }

  async listForUser(userId: number, filters: NotificationListFilters) {
    const [{ rows, totalCount }, counts] = await Promise.all([
      this.notificationsRepository.listForRecipient(userId, filters),
      this.notificationsRepository.countForRecipient(userId),
    ]);
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);
    const page = Math.max(filters.page ?? 1, 1);
    return {
      rows: rows.map((row) => ({
        id: row.id,
        type_code: row.type_code,
        type_label: row.type_label,
        title: row.title,
        body: row.body,
        ref_entity: row.ref_entity,
        ref_id: row.ref_id,
        seen_at: row.seen_at,
        read_at: row.read_at,
        created_at: row.created_at,
      })),
      totalCount,
      page,
      limit,
      unreadCount: counts.unreadCount,
      unseenCount: counts.unseenCount,
    };
  }

  async markAllSeen(userId: number) {
    const updated = await this.notificationsRepository.markAllSeen(userId);
    return { success: true, updated };
  }

  async markRead(userId: number, notificationId: string) {
    const updated = await this.notificationsRepository.markRead(userId, notificationId);
    if (!updated) {
      throw new NotFoundException('ไม่พบการแจ้งเตือนนี้');
    }
    return { success: true };
  }

  async markAllRead(userId: number) {
    const updated = await this.notificationsRepository.markAllRead(userId);
    return { success: true, updated };
  }
}
