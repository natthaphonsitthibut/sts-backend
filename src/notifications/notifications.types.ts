export interface NotificationRow extends Record<string, unknown> {
  id: string;
  type_code: string;
  type_label: string | null;
  title: string;
  body: string | null;
  student_person_uuid: string | null;
  case_id: number | null;
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
  studentUuid?: string | null;
  studentNameMasked?: string | null;
  reasonText?: string | null;
  refEntity?: string | null;
  refId?: string | null;
  schoolId?: number | null;
  gradeLevel?: string | number | null;
  roomId?: string | number | null;
  excludeUserId?: number | null;
}

export interface DirectNotificationInput {
  recipientUserId: number;
  typeCode: string;
  title: string;
  body?: string | null;
  refEntity?: string | null;
  refId?: string | null;
}

export interface NotificationListFilters {
  unreadOnly?: boolean;
  page?: number;
  limit?: number;
}
