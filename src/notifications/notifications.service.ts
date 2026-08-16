import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import { NotificationsRepository } from './notifications.repository';
import type {
  CaseStatusNotificationContext,
  NotificationFanOutInput,
  NotificationListFilters,
} from './notifications.types';

const CASE_STATUS_LABELS: Record<string, string> = {
  OPEN: 'รอมอบหมาย',
  IN_PROGRESS: 'รอติดตาม',
  PENDING_REVIEW: 'รอพิจารณา',
  RESOLVED: 'เสร็จสิ้น',
  STUDENT_NOT_FOUND: 'ไม่พบนักเรียน',
};
const NOTIFICATION_RETENTION_DAYS = 90;
const NOTIFICATION_RETENTION_CRON = '0 30 3 * * *';

function text(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function formatThaiDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  return `${match[3]}/${match[2]}/${Number(match[1]) + 543}`;
}

function joinDetails(...parts: Array<string | null>): string | null {
  const detail = parts.filter((part): part is string => Boolean(part)).join(' · ');
  return detail || null;
}

function formatCaseStatusDetail(
  status: string,
  context: CaseStatusNotificationContext | null,
): string | null {
  const note = text(context?.latestTeacherComment);
  const fallbackNote = formatThaiDate(context?.latestAbsentDate);
  const followUpResult = text(context?.resultSummary) ?? text(context?.reviewSummary);
  const reviewResult =
    text(context?.reviewNote) ?? followUpResult ?? text(context?.completionOutcomeLabel);

  switch (status) {
    case 'OPEN':
      return joinDetails(
        text(context?.reasonFlagged)
          ? `เหตุผลที่ขาด: ${text(context?.reasonFlagged)}`
          : 'เหตุผลที่ขาด: ไม่ระบุ',
        note ? `หมายเหตุ: ${note}` : fallbackNote ? `ขาดล่าสุด: ${fallbackNote}` : null,
      );
    case 'IN_PROGRESS':
      return joinDetails(
        text(context?.assignedTeacherName)
          ? `มอบหมายให้: ${text(context?.assignedTeacherName)}`
          : 'มอบหมายการติดตามแล้ว',
        note ? `หมายเหตุ: ${note}` : null,
      );
    case 'PENDING_REVIEW':
      return joinDetails(
        followUpResult ? `ผลการติดตาม: ${followUpResult}` : 'ผลการติดตาม: รอผลการพิจารณา',
        note ? `หมายเหตุ: ${note}` : null,
      );
    case 'RESOLVED':
      return reviewResult ? `ผลการพิจารณา: ${reviewResult}` : 'ผลการพิจารณา: ดำเนินการเสร็จสิ้น';
    case 'STUDENT_NOT_FOUND':
      return reviewResult
        ? `ผลการตรวจสอบ: ${reviewResult}`
        : 'ผลการตรวจสอบ: ไม่พบนักเรียนตามข้อมูลที่ได้รับ';
    default:
      return null;
  }
}

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
    // Notification recipients have already passed permission and data-scope
    // filtering in the repository, so show the student's real name here.
    const student = event.studentName?.trim() || 'นักเรียน';
    let context: CaseStatusNotificationContext | null = null;
    try {
      context = await this.notificationsRepository.findCaseStatusNotificationContext(event.caseId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Notification context lookup failed for case ${event.caseId}: ${message}`);
    }
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
      reasonText: formatCaseStatusDetail(event.nextStatus, context),
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
