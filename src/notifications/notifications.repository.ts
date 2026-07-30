import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource } from '../database/sql-query';
import type {
  DirectNotificationInput,
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

const SCOPE_COVERS_EVENT_SQL = `
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
      AND ${scopeDimensionSql('school_ids', '$7::text')}
      AND ${scopeDimensionSql('provinces', 'sc.province')}
      AND ${scopeDimensionSql('districts', 'sc.district')}
      AND ${scopeDimensionSql('sub_districts', 'sc.sub_district')}
      AND ${scopeDimensionSql('grade_levels', '$8::text')}
      AND ${scopeDimensionSql('room_ids', '$9::text')}
    )
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
   * data_scope covers the event context. Returns the number of recipients.
   */
  async fanOut(input: NotificationFanOutInput): Promise<number> {
    const result = await this.query(
      `
        INSERT INTO notifications
          (recipient_user_id, type_code, title, body, ref_entity, ref_id,
           student_person_uuid, case_id, student_name_masked, reason_text)
        SELECT
          u.id,
          nt.code,
          $2,
          $3,
          $4,
          $5,
          COALESCE(notification_case_student.person_uuid, notification_student.person_uuid),
          $10::int,
          $12,
          $13
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
          AND u.role IS DISTINCT FROM 'STUDENT'
          AND u.data_origin_code <> 'AUTOMATED_TEST'
          AND ($6::int IS NULL OR u.id <> $6::int)
          AND CASE
            WHEN jsonb_typeof(u.permissions) = 'array' AND jsonb_array_length(u.permissions) > 0
              THEN u.permissions ? nt.required_permission
            ELSE COALESCE(r.default_permissions ? nt.required_permission, FALSE)
          END
          AND ${SCOPE_COVERS_EVENT_SQL}
        RETURNING id
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
        input.studentNameMasked ?? null,
        input.reasonText ?? null,
      ],
    );
    return result.rows.length;
  }

  async createForEligibleRecipient(input: DirectNotificationInput): Promise<boolean> {
    const result = await this.query(
      `
        INSERT INTO notifications (recipient_user_id, type_code, title, body, ref_entity, ref_id)
        SELECT u.id, nt.code, $3, $4, $5, $6
        FROM users u
        CROSS JOIN notification_types nt
        LEFT JOIN roles r ON r.name = u.role
        WHERE u.id = $1
          AND nt.code = $2
          AND nt.is_enabled IS TRUE
          AND u.status = 'ACTIVE'
          AND u.role IS DISTINCT FROM 'STUDENT'
          AND u.data_origin_code <> 'AUTOMATED_TEST'
          AND CASE
            WHEN jsonb_typeof(u.permissions) = 'array' AND jsonb_array_length(u.permissions) > 0
              THEN u.permissions ? nt.required_permission
            ELSE COALESCE(r.default_permissions ? nt.required_permission, FALSE)
          END
        RETURNING id
      `,
      [
        input.recipientUserId,
        input.typeCode,
        input.title,
        input.body ?? null,
        input.refEntity ?? null,
        input.refId ?? null,
      ],
    );
    return result.rows.length > 0;
  }

  async listForRecipient(
    recipientUserId: number,
    filters: NotificationListFilters,
  ): Promise<{ rows: NotificationRow[]; totalCount: number }> {
    const limit = Math.min(Math.max(filters.limit ?? 20, 1), 50);
    const page = Math.max(filters.page ?? 1, 1);
    const offset = (page - 1) * limit;
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
          n.student_name_masked,
          n.reason_text,
          n.ref_entity,
          n.ref_id,
          n.seen_at,
          n.read_at,
          n.created_at,
          COUNT(*) OVER ()::int AS total_count
        FROM notifications n
        LEFT JOIN notification_types nt ON nt.code = n.type_code
        WHERE n.recipient_user_id = $1
          AND ($2::boolean IS NOT TRUE OR n.read_at IS NULL)
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT $3 OFFSET $4
      `,
      [recipientUserId, filters.unreadOnly === true, limit, offset],
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
        FROM notifications
        WHERE recipient_user_id = $1
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
