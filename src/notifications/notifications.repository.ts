import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource } from '../database/sql-query';
import type {
  CaseStatusNotificationContext,
  NotificationCounts,
  NotificationFanOutInput,
  NotificationListFilters,
  NotificationRow,
} from './notifications.types';

interface QueryResultLike<T extends Record<string, unknown>> {
  rows: T[];
  rowCount?: number | null;
}

/**
 * Coverage clause for one recipient data_scope dimension: the key must be
 * absent/empty, or a well-formed array containing the event's value. A key
 * that exists but is not an array fails closed for that user.
 */
function scopeDimensionSql(key: string, valueSql: string): string {
  const dimension = `u.data_scope->'${key}'`;
  return `(
    NOT (u.data_scope ? '${key}')
    OR (
      jsonb_typeof(${dimension}) = 'array'
      AND (
        jsonb_array_length(${dimension}) = 0
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(${dimension}) dim(val)
          WHERE dim.val = ${valueSql}
        )
      )
    )
  )`;
}

function scopeDimensionPresentSql(key: string): string {
  const dimension = `u.data_scope->'${key}'`;
  return `(
    u.data_scope ? '${key}'
    AND jsonb_typeof(${dimension}) = 'array'
    AND jsonb_array_length(${dimension}) > 0
  )`;
}

function scopeCoversEventSql(
  schoolValueSql: string,
  gradeValueSql: string,
  roomValueSql: string,
): string {
  return `
  (
    u.data_scope->'global' = 'true'::jsonb
    OR (
      jsonb_typeof(u.data_scope) = 'object'
      AND COALESCE(u.data_scope->'own_only', 'false'::jsonb) <> 'true'::jsonb
      AND (
        ${scopeDimensionPresentSql('school_ids')}
        OR ${scopeDimensionPresentSql('provinces')}
        OR ${scopeDimensionPresentSql('districts')}
        OR ${scopeDimensionPresentSql('sub_districts')}
        OR ${scopeDimensionPresentSql('grade_levels')}
        OR ${scopeDimensionPresentSql('room_ids')}
      )
      AND ${scopeDimensionSql('school_ids', schoolValueSql)}
      AND ${scopeDimensionSql('provinces', 'sc.province')}
      AND ${scopeDimensionSql('districts', 'sc.district')}
      AND ${scopeDimensionSql('sub_districts', 'sc.sub_district')}
      AND ${scopeDimensionSql('grade_levels', gradeValueSql)}
      AND ${scopeDimensionSql('room_ids', roomValueSql)}
    )
  )
`;
}

const SCOPE_COVERS_EVENT_SQL = scopeCoversEventSql(
  '$7::text',
  'COALESCE($8::text, notification_case_student."GradeLevelID_Onec"::text, notification_student."GradeLevelID_Onec"::text)',
  'COALESCE($9::text, notification_case_student."RoomID_Onec"::text, notification_student."RoomID_Onec"::text)',
);

const CURRENT_RECIPIENT_ACCESS_JOINS_SQL = `
  JOIN users u ON u.id = n.recipient_user_id
  LEFT JOIN roles r ON r.name = u.role
  LEFT JOIN cases notification_case ON notification_case.id = n.case_id
  LEFT JOIN student_term notification_case_student
    ON notification_case_student.student_uuid = notification_case.student_uuid
   AND notification_case_student.deleted_at IS NULL
  LEFT JOIN student_current_enrollment_resolution notification_student_resolution
    ON notification_student_resolution.person_uuid = n.student_person_uuid
   AND notification_student_resolution.resolution_state = 'ACTIVE'
  LEFT JOIN student_term notification_student
    ON notification_student.student_uuid = notification_student_resolution.selected_student_uuid
   AND notification_student.deleted_at IS NULL
  LEFT JOIN schools sc ON sc.id = COALESCE(
    notification_case.school_id,
    notification_case_student."SchoolID_Onec",
    notification_student."SchoolID_Onec"
  )
`;

const CURRENT_RECIPIENT_ACCESS_WHERE_SQL = `
  u.status = 'ACTIVE'
  AND CASE
    WHEN jsonb_typeof(u.permissions) = 'array'
      THEN u.permissions ? nt.required_permission
    ELSE COALESCE(r.default_permissions ? nt.required_permission, FALSE)
  END
  AND (
    (n.case_id IS NULL AND n.student_person_uuid IS NULL)
    OR ${scopeCoversEventSql(
      'COALESCE(notification_case.school_id::text, notification_case_student."SchoolID_Onec"::text, notification_student."SchoolID_Onec"::text)',
      'COALESCE(notification_case_student."GradeLevelID_Onec"::text, notification_student."GradeLevelID_Onec"::text)',
      'COALESCE(notification_case_student."RoomID_Onec"::text, notification_student."RoomID_Onec"::text)',
    )}
  )
`;

@Injectable()
export class NotificationsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private async query<T extends Record<string, unknown>>(
    sql: string,
    params: unknown[],
  ): Promise<QueryResultLike<T>> {
    return await queryDataSource<T>(this.dataSource, sql, params);
  }

  /**
   * Insert one notification row per eligible recipient in a single statement.
   * Eligibility is enforced here, at write time: active non-student users whose
   * effective permission set contains the type's required permission and whose
   * data_scope covers the event context. Returns the recipient user ids, so a
   * caller raising a second notification for the same event can exclude whoever
   * was already told.
   */
  async fanOut(input: NotificationFanOutInput): Promise<number[]> {
    const result = await this.query(
      `
        INSERT INTO notifications
          (recipient_user_id, type_code, title, body, ref_entity, ref_id,
           student_person_uuid, case_id, case_status_code, student_name_snapshot, reason_text)
        SELECT
          u.id,
          nt.code,
          $2,
          $3,
          $4,
          $5,
          COALESCE(notification_case_student.person_uuid, notification_student.person_uuid),
          $10::int,
          $15::varchar,
          $12,
          CASE
            WHEN nt.code = 'CASE_STATUS_CHANGED'
              THEN COALESCE(
                NULLIF(btrim($13::text), ''),
                NULLIF(btrim(notification_case.reason_flagged), '')
              )
            ELSE NULL
          END
        FROM notification_types nt
        CROSS JOIN users u
        LEFT JOIN roles r ON r.name = u.role
        LEFT JOIN schools sc ON sc.id = $7::int
        LEFT JOIN cases notification_case ON notification_case.id = $10::int
        LEFT JOIN student_term notification_case_student
          ON notification_case_student.student_uuid = notification_case.student_uuid
        LEFT JOIN student_term notification_student
          ON notification_student.student_uuid = $11::uuid
        WHERE nt.code = $1
          AND nt.is_enabled IS TRUE
          AND u.status = 'ACTIVE'
          AND u.data_origin_code <> 'AUTOMATED_TEST'
          AND ($6::int IS NULL OR u.id <> $6::int)
          AND NOT (u.id = ANY($14::int[]))
          AND CASE
            WHEN jsonb_typeof(u.permissions) = 'array'
              THEN u.permissions ? nt.required_permission
            ELSE COALESCE(r.default_permissions ? nt.required_permission, FALSE)
          END
          AND ${SCOPE_COVERS_EVENT_SQL}
        RETURNING recipient_user_id
      `,
      [
        input.typeCode,
        input.title,
        input.body ?? null,
        input.refEntity ?? null,
        input.refId ?? null,
        input.excludeUserId ?? null,
        input.schoolId ?? null,
        input.gradeLevel === null || input.gradeLevel === undefined
          ? null
          : String(input.gradeLevel),
        input.roomId === null || input.roomId === undefined ? null : String(input.roomId),
        input.caseId ?? null,
        input.studentUuid ?? null,
        input.studentNameSnapshot ?? null,
        input.reasonText ?? null,
        input.excludeUserIds ?? [],
        input.caseStatusCode,
      ],
    );
    return result.rows.map((row) => Number(row.recipient_user_id));
  }

  async findCaseStatusNotificationContext(
    caseId: number,
  ): Promise<CaseStatusNotificationContext | null> {
    const result = await this.query<{
      reason_flagged: string | null;
      latest_teacher_comment: string | null;
      latest_absent_date: string | null;
      assigned_teacher_name: string | null;
      result_summary: string | null;
      review_note: string | null;
      review_summary: string | null;
      completion_outcome_label: string | null;
    }>(
      `
        SELECT
          NULLIF(BTRIM(c.reason_flagged), '') AS reason_flagged,
          NULLIF(BTRIM(latest_comment.problem_description), '') AS latest_teacher_comment,
          latest_absence.attendance_date::text AS latest_absent_date,
          NULLIF(BTRIM(latest_assignment.assigned_to_name), '') AS assigned_teacher_name,
          NULLIF(BTRIM(c.result_summary), '') AS result_summary,
          NULLIF(BTRIM(latest_review.review_note), '') AS review_note,
          NULLIF(BTRIM(latest_review.review_summary), '') AS review_summary,
          NULLIF(BTRIM(completion_outcome.label_th), '') AS completion_outcome_label
        FROM cases c
        LEFT JOIN student_term student
          ON student.student_uuid = c.student_uuid
        LEFT JOIN LATERAL (
          SELECT comment.problem_description
          FROM classroom_student_comments comment
          WHERE comment.classroom_id = student.classroom_id
            AND comment.person_uuid = student.person_uuid
          ORDER BY comment.created_at DESC, comment.id DESC
          LIMIT 1
        ) latest_comment ON TRUE
        LEFT JOIN LATERAL (
          SELECT attendance."AttendanceDate"::date AS attendance_date
          FROM attendance_effective_records attendance
          WHERE attendance.student_uuid = c.student_uuid
            AND attendance.session_kind = 'SUBJECT'
          GROUP BY attendance."AttendanceDate"::date
          HAVING COUNT(*) FILTER (WHERE attendance."AttendanceStatus" <> 4) > 0
             AND COUNT(*) FILTER (WHERE attendance."AttendanceStatus" IN (1, 3)) = 0
          ORDER BY attendance."AttendanceDate"::date DESC
          LIMIT 1
        ) latest_absence ON TRUE
        LEFT JOIN LATERAL (
          SELECT link.assigned_to_name
          FROM tasks task
          JOIN task_links link
            ON link.task_id = task.id
           AND link.deleted_at IS NULL
          WHERE task.case_id = c.id
            AND task.deleted_at IS NULL
          ORDER BY (link.status = 'ACTIVE') DESC, link.created_at DESC, link.id DESC
          LIMIT 1
        ) latest_assignment ON TRUE
        LEFT JOIN LATERAL (
          SELECT review.review_note, review.review_summary
          FROM case_reviews review
          WHERE review.case_id = c.id
          ORDER BY review.reviewed_at DESC, review.id DESC
          LIMIT 1
        ) latest_review ON TRUE
        LEFT JOIN case_completion_outcomes completion_outcome
          ON completion_outcome.code = c.completion_outcome_code
        WHERE c.id = $1
          AND c.deleted_at IS NULL
        LIMIT 1
      `,
      [caseId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      reasonFlagged: row.reason_flagged,
      latestTeacherComment: row.latest_teacher_comment,
      latestAbsentDate: row.latest_absent_date,
      assignedTeacherName: row.assigned_teacher_name,
      resultSummary: row.result_summary,
      reviewNote: row.review_note,
      reviewSummary: row.review_summary,
      completionOutcomeLabel: row.completion_outcome_label,
    };
  }

  async listForRecipient(
    recipientUserId: number,
    filters: NotificationListFilters,
  ): Promise<{ rows: NotificationRow[]; totalCount: number }> {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);
    const page = Math.max(filters.page ?? 1, 1);
    const offset = (page - 1) * limit;
    const status = filters.status ?? (filters.unreadOnly ? 'unread' : 'all');
    const result = await this.query<NotificationRow>(
      `
        SELECT
          n.id,
          n.type_code,
          nt.label_th AS type_label,
          n.title,
          n.body,
          n.student_person_uuid,
          n.case_id,
          n.case_status_code,
          COALESCE(
            NULLIF(BTRIM(notification_case.student_name), ''),
            n.student_name_snapshot
          ) AS student_name_snapshot,
          n.reason_text,
          n.ref_entity,
          n.ref_id,
          n.seen_at,
          n.read_at,
          n.created_at,
          COUNT(*) OVER ()::int AS total_count
        FROM notifications n
        JOIN notification_types nt ON nt.code = n.type_code
        ${CURRENT_RECIPIENT_ACCESS_JOINS_SQL}
        WHERE n.recipient_user_id = $1
          AND ${CURRENT_RECIPIENT_ACCESS_WHERE_SQL}
          AND (
            $2::text = 'all'
            OR ($2::text = 'unread' AND n.read_at IS NULL)
            OR ($2::text = 'read' AND n.read_at IS NOT NULL)
          )
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT $3 OFFSET $4
      `,
      [recipientUserId, status, limit, offset],
    );
    const totalCount = Number(result.rows[0]?.total_count ?? 0);
    return { rows: result.rows, totalCount };
  }

  async countForRecipient(recipientUserId: number): Promise<NotificationCounts> {
    const result = await this.query<{
      unread_count: number | string;
      unseen_count: number | string;
    }>(
      `
        SELECT
          COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread_count,
          COUNT(*) FILTER (WHERE seen_at IS NULL)::int AS unseen_count
        FROM notifications n
        JOIN notification_types nt ON nt.code = n.type_code
        ${CURRENT_RECIPIENT_ACCESS_JOINS_SQL}
        WHERE n.recipient_user_id = $1
          AND ${CURRENT_RECIPIENT_ACCESS_WHERE_SQL}
      `,
      [recipientUserId],
    );
    return {
      unreadCount: Number(result.rows[0]?.unread_count ?? 0),
      unseenCount: Number(result.rows[0]?.unseen_count ?? 0),
    };
  }

  async markAllSeen(recipientUserId: number): Promise<number> {
    const result = await this.query(
      `
        UPDATE notifications
        SET seen_at = CURRENT_TIMESTAMP
        WHERE recipient_user_id = $1 AND seen_at IS NULL
        RETURNING id
      `,
      [recipientUserId],
    );
    return result.rows.length;
  }

  async markRead(recipientUserId: number, notificationId: string): Promise<boolean> {
    const result = await this.query(
      `
        UPDATE notifications
        SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP),
            seen_at = COALESCE(seen_at, CURRENT_TIMESTAMP)
        WHERE id = $2 AND recipient_user_id = $1
        RETURNING id
      `,
      [recipientUserId, notificationId],
    );
    return result.rows.length > 0;
  }

  async markAllRead(recipientUserId: number): Promise<number> {
    const result = await this.query(
      `
        UPDATE notifications
        SET read_at = CURRENT_TIMESTAMP,
            seen_at = COALESCE(seen_at, CURRENT_TIMESTAMP)
        WHERE recipient_user_id = $1 AND read_at IS NULL
        RETURNING id
      `,
      [recipientUserId],
    );
    return result.rows.length;
  }

  async deleteAllRead(recipientUserId: number): Promise<number> {
    const result = await this.query(
      `
        DELETE FROM notifications
        WHERE recipient_user_id = $1 AND read_at IS NOT NULL
        RETURNING id
      `,
      [recipientUserId],
    );
    return result.rows.length;
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const result = await this.query(
      `
        DELETE FROM notifications
        WHERE created_at < $1
        RETURNING id
      `,
      [cutoff],
    );
    return result.rows.length;
  }

  async findTaskContext(taskId: string): Promise<{
    case_id: number | null;
    target_school_id: number | null;
    target_grade: string | null;
    target_room: string | null;
  } | null> {
    const result = await this.query<{
      case_id: number | null;
      target_school_id: number | null;
      target_grade: string | null;
      target_room: string | null;
    }>(
      `
        SELECT case_id, target_school_id, target_grade, target_room
        FROM tasks
        WHERE id = $1
      `,
      [taskId],
    );
    return result.rows[0] ?? null;
  }
}
