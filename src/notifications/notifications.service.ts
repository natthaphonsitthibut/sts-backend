import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { maskName } from '../common/utils/helpers';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import { NotificationsRepository } from './notifications.repository';
import type { NotificationFanOutInput, NotificationListFilters } from './notifications.types';

const CASE_STATUS_LABELS: Record<string, string> = {
  OPEN: 'รอมอบหมาย',
  IN_PROGRESS: 'รอติดตาม',
  PENDING_REVIEW: 'รอพิจารณา',
  RESOLVED: 'เสร็จสิ้น',
  STUDENT_NOT_FOUND: 'ไม่พบนักเรียน',
};
const NOTIFICATION_RETENTION_DAYS = 90;
const NOTIFICATION_RETENTION_CRON = '0 30 3 * * *';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly notificationsRepository: NotificationsRepository) {}

  /** A notification failure must never roll back a case transition. */
  private async fanOutSafely(input: NotificationFanOutInput): Promise<number[]> {
    try {
      const recipients = await this.notificationsRepository.fanOut(input);
      this.logger.log(
        `Notification ${input.typeCode} fanned out to ${recipients.length} recipient(s).`,
      );
      return recipients;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Notification fan-out failed for ${input.typeCode}: ${message}`);
      return [];
    }
  }

  async notifyCaseStatusChanged(event: {
    caseId: number;
    studentName: string | null;
    schoolId: number | null;
    nextStatus: string;
    actorUserId: number | null;
    completionOutcomeCode?: string | null;
  }): Promise<number[]> {
    const completionLabel =
      event.completionOutcomeCode === 'CLOSED'
        ? 'ปิดเคส'
        : event.completionOutcomeCode === 'REFERRED_AGENCY'
          ? 'ส่งต่อหน่วยงาน'
          : null;
    const baseStatusLabel = CASE_STATUS_LABELS[event.nextStatus] ?? event.nextStatus;
    const statusLabel = completionLabel
      ? `${baseStatusLabel} : ${completionLabel}`
      : baseStatusLabel;
    const student = event.studentName ? maskName(event.studentName) : 'นักเรียน';
    return await this.fanOutSafely({
      typeCode: 'CASE_STATUS_CHANGED',
      title: `เคสเปลี่ยนสถานะ: ${statusLabel}`,
      body: student,
      caseId: event.caseId,
      caseStatusCode: event.nextStatus,
      studentNameMasked: student,
      refEntity: 'case',
      refId: String(event.caseId),
      schoolId: event.schoolId,
      excludeUserId: event.actorUserId,
    });
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
        student_person_uuid: row.student_person_uuid,
        case_id: row.case_id,
        case_status_code: row.case_status_code,
        student_name_masked: row.student_name_masked,
        reason_text: row.reason_text,
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

  async deleteAllRead(userId: number) {
    const deleted = await this.notificationsRepository.deleteAllRead(userId);
    return { success: true, deleted };
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
