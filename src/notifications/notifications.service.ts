import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { maskName } from '../common/utils/helpers';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import { NotificationsRepository } from './notifications.repository';
import type { NotificationFanOutInput, NotificationListFilters } from './notifications.types';
import type { DirectNotificationInput } from './notifications.types';

const CASE_STATUS_LABELS: Record<string, string> = {
  OPEN: 'เปิดเคส',
  IN_PROGRESS: 'กำลังติดตาม',
  PENDING_REVIEW: 'รอพิจารณา',
  AWAITING_HELP: 'ส่งต่อหน่วยงาน',
  RESOLVED: 'ปิดเคสแล้ว',
};
const NOTIFICATION_RETENTION_DAYS = 90;
const NOTIFICATION_RETENTION_CRON = '0 30 3 * * *';

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

  private async createForRecipientSafely(input: DirectNotificationInput): Promise<void> {
    try {
      const created = await this.notificationsRepository.createForEligibleRecipient(input);
      if (created) {
        this.logger.log(
          `Notification ${input.typeCode} created for recipient ${input.recipientUserId}.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Notification creation failed for ${input.typeCode}: ${message}`);
    }
  }

  async notifyImportCompleted(event: {
    batchId: string;
    actorUserId: number;
    targetLabel: string;
    importedRows: number;
    quarantinedRows: number;
  }): Promise<void> {
    await this.createForRecipientSafely({
      recipientUserId: event.actorUserId,
      typeCode: 'IMPORT_COMPLETED',
      title: 'นำเข้าข้อมูลเสร็จแล้ว',
      body: `${event.targetLabel} · สำเร็จ ${event.importedRows} รายการ · รอตรวจ ${event.quarantinedRows} รายการ`,
      refEntity: 'import',
      refId: event.batchId,
    });
  }

  async notifyImportFailed(event: {
    batchId: string;
    actorUserId: number;
    targetLabel: string;
  }): Promise<void> {
    await this.createForRecipientSafely({
      recipientUserId: event.actorUserId,
      typeCode: 'IMPORT_FAILED',
      title: 'นำเข้าข้อมูลไม่สำเร็จ',
      body: event.targetLabel,
      refEntity: 'import',
      refId: event.batchId,
    });
  }

  async notifyStudentAccountBatchCompleted(event: {
    jobId: string;
    actorUserId: number;
    createdCount: number;
    skippedCount: number;
    failedCount: number;
  }): Promise<void> {
    await this.createForRecipientSafely({
      recipientUserId: event.actorUserId,
      typeCode: 'STUDENT_ACCOUNT_BATCH_COMPLETED',
      title: 'สร้างบัญชีนักเรียนเสร็จแล้ว',
      body: `สร้าง ${event.createdCount} บัญชี · ข้าม ${event.skippedCount} รายการ · ไม่สำเร็จ ${event.failedCount} รายการ`,
      refEntity: 'student-account-batch',
      refId: event.jobId,
    });
  }

  async notifyStudentAccountBatchFailed(event: {
    jobId: string;
    actorUserId: number;
  }): Promise<void> {
    await this.createForRecipientSafely({
      recipientUserId: event.actorUserId,
      typeCode: 'STUDENT_ACCOUNT_BATCH_FAILED',
      title: 'สร้างบัญชีนักเรียนไม่สำเร็จ',
      body: 'เปิดประวัติงานเพื่อตรวจสอบและลองทำต่อ',
      refEntity: 'student-account-batch',
      refId: event.jobId,
    });
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

  async notifyAccountDeactivated(event: {
    userId: number;
    displayName: string | null;
    schoolId: number | null;
    actorUserId: number | null;
  }): Promise<void> {
    const who = event.displayName ? maskName(event.displayName) : 'บัญชีผู้ใช้งาน';
    await this.fanOutSafely({
      typeCode: 'ACCOUNT_DEACTIVATED',
      title: 'มีบัญชีถูกปิดใช้งาน',
      body: who,
      refEntity: 'user',
      refId: String(event.userId),
      schoolId: event.schoolId,
      excludeUserId: event.actorUserId,
    });
  }

  async notifyAccountReactivated(event: {
    userId: number;
    displayName: string | null;
    schoolId: number | null;
    actorUserId: number | null;
  }): Promise<void> {
    const who = event.displayName ? maskName(event.displayName) : 'บัญชีผู้ใช้งาน';
    await this.fanOutSafely({
      typeCode: 'ACCOUNT_REACTIVATED',
      title: 'มีบัญชีถูกเปิดใช้งานอีกครั้ง',
      body: who,
      refEntity: 'user',
      refId: String(event.userId),
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

  async cleanupExpiredNotifications(now = new Date()): Promise<{ deleted: number }> {
    const cutoff = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await this.notificationsRepository.deleteOlderThan(cutoff);
    if (deleted > 0) {
      this.logger.log(
        `Deleted ${deleted} notification(s) older than ${NOTIFICATION_RETENTION_DAYS} days.`,
      );
    }
    return { deleted };
  }

  @Cron(NOTIFICATION_RETENTION_CRON, {
    timeZone: BANGKOK_TIME_ZONE,
    name: 'notifications_retention_cleanup',
  })
  async runRetentionCleanup(): Promise<void> {
    try {
      await this.cleanupExpiredNotifications();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Notification retention cleanup failed: ${message}`);
    }
  }
}
