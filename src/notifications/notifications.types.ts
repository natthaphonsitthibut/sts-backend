export interface NotificationRow extends Record<string, unknown> {
  id: string;
  type_code: string;
  type_label: string | null;
  title: string;
  body: string | null;
  student_person_uuid: string | null;
  case_id: number | null;
  case_status_code: string;
  student_name_masked: string | null;
  reason_text: string | null;
  ref_entity: string | null;
  ref_id: string | null;
  seen_at: string | Date | null;
  read_at: string | Date | null;
  created_at: string | Date;
  total_count?: number | string;
}

export interface NotificationCounts {
  unreadCount: number;
  unseenCount: number;
}

export const NOTIFICATION_READ_STATUSES = ['all', 'unread', 'read'] as const;
export type NotificationReadStatus = (typeof NOTIFICATION_READ_STATUSES)[number];

/**
 * Context describing where an event happened, used to resolve which users are
 * allowed to be notified. Every attribute the recipient's data_scope narrows
 * on must be provided; a missing attribute fails closed for users whose scope
 * requires it.
 */
export interface NotificationFanOutInput {
  typeCode: string;
  title: string;
  body?: string | null;
  caseId?: number | null;
  caseStatusCode: string;
  studentUuid?: string | null;
  studentNameMasked?: string | null;
  reasonText?: string | null;
  refEntity?: string | null;
  refId?: string | null;
  schoolId?: number | null;
  gradeLevel?: string | number | null;
  roomId?: string | number | null;
  excludeUserId?: number | null;
  excludeUserIds?: number[] | null;
}

export interface NotificationListFilters {
  unreadOnly?: boolean;
  status?: NotificationReadStatus;
  page?: number;
  limit?: number;
}
