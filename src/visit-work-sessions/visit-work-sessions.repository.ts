import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { queryDataSource } from '../database/sql-query';
import type {
  MonitorWorkSessionRow,
  RecentlyEndedWorkSessionRow,
  VisitWorkSessionRow,
  WorkSessionEndReason,
} from './visit-work-sessions.types';

const MONITOR_JOIN_SQL = `
  FROM visit_work_sessions vws
  JOIN task_links tl ON tl.id = vws.task_link_id
  JOIN tasks t ON t.id = tl.task_id
  LEFT JOIN cases c ON c.id = t.case_id
  LEFT JOIN schools sc ON sc.id = c.school_id
`;

@Injectable()
export class VisitWorkSessionsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findOpenSessionByLinkId(linkId: string): Promise<VisitWorkSessionRow | null> {
    const result = await queryDataSource<VisitWorkSessionRow>(
      this.dataSource,
      `SELECT * FROM visit_work_sessions WHERE task_link_id = $1 AND ended_at IS NULL`,
      [linkId],
    );
    return result.rows[0] ?? null;
  }

  async startSession(linkId: string, consentAt: Date): Promise<VisitWorkSessionRow> {
    const result = await queryDataSource<VisitWorkSessionRow>(
      this.dataSource,
      `
        INSERT INTO visit_work_sessions (task_link_id, consent_at)
        VALUES ($1, $2)
        RETURNING *
      `,
      [linkId, consentAt],
    );
    return result.rows[0];
  }

  async endOpenSessionByLinkId(
    linkId: string,
    reason: WorkSessionEndReason,
  ): Promise<VisitWorkSessionRow | null> {
    const result = await queryDataSource<VisitWorkSessionRow>(
      this.dataSource,
      `
        UPDATE visit_work_sessions
        SET ended_at = now(), end_reason = $2, updated_at = now()
        WHERE task_link_id = $1 AND ended_at IS NULL
        RETURNING *
      `,
      [linkId, reason],
    );
    return result.rows[0] ?? null;
  }

  /** Inserts only if the session is still open — fail-closed against a race with end/timeout. */
  async insertPingIfOpen(sessionId: string, lat: number, lng: number): Promise<boolean> {
    const result = await queryDataSource<{ id: string }>(
      this.dataSource,
      `
        INSERT INTO visit_position_pings (session_id, lat, lng)
        SELECT $1, $2, $3
        WHERE EXISTS (
          SELECT 1 FROM visit_work_sessions WHERE id = $1 AND ended_at IS NULL
        )
        RETURNING id
      `,
      [sessionId, lat, lng],
    );
    return result.rows.length > 0;
  }

  private scopeClause(scope: DataScope, startIndex: number): { sql: string; params: unknown[] } {
    return buildDataScopeQuery(
      scope,
      {
        school_id: 'c.school_id',
        province: 'sc.province',
        district: 'sc.district',
        sub_district: 'sc.sub_district',
      },
      startIndex,
    );
  }

  async listActiveForMonitor(scope: DataScope): Promise<MonitorWorkSessionRow[]> {
    const params: unknown[] = [];
    const conditions: string[] = ['vws.ended_at IS NULL'];
    const scopeResult = this.scopeClause(scope, params.length + 1);
    if (scopeResult.sql) {
      conditions.push(`(${scopeResult.sql})`);
      params.push(...scopeResult.params);
    }

    const result = await queryDataSource<MonitorWorkSessionRow>(
      this.dataSource,
      `
        SELECT
          vws.id AS session_id,
          vws.task_link_id,
          vws.started_at,
          vws.consent_at,
          tl.assigned_to_name,
          c.student_name,
          sc.name AS school_name,
          latest_ping.lat AS last_ping_lat,
          latest_ping.lng AS last_ping_lng,
          latest_ping.recorded_at AS last_ping_at
        ${MONITOR_JOIN_SQL}
        LEFT JOIN LATERAL (
          SELECT lat, lng, recorded_at
          FROM visit_position_pings p
          WHERE p.session_id = vws.id
          ORDER BY p.recorded_at DESC
          LIMIT 1
        ) latest_ping ON true
        WHERE ${conditions.join(' AND ')}
        ORDER BY vws.started_at DESC
      `,
      params,
    );
    return result.rows;
  }

  async listRecentlyEnded(scope: DataScope, limit = 20): Promise<RecentlyEndedWorkSessionRow[]> {
    const params: unknown[] = [];
    const conditions: string[] = ['vws.ended_at IS NOT NULL'];
    const scopeResult = this.scopeClause(scope, params.length + 1);
    if (scopeResult.sql) {
      conditions.push(`(${scopeResult.sql})`);
      params.push(...scopeResult.params);
    }
    params.push(limit);

    const result = await queryDataSource<RecentlyEndedWorkSessionRow>(
      this.dataSource,
      `
        SELECT
          vws.id AS session_id,
          vws.task_link_id,
          vws.started_at,
          vws.ended_at,
          vws.end_reason,
          tl.assigned_to_name,
          c.student_name
        ${MONITOR_JOIN_SQL}
        WHERE ${conditions.join(' AND ')}
        ORDER BY vws.ended_at DESC
        LIMIT $${params.length}
      `,
      params,
    );
    return result.rows;
  }

  /** Claims (closes) sessions whose latest ping — or start, if no ping yet — is older than cutoff. */
  async claimTimedOutSessions(cutoff: Date): Promise<Array<{ id: string; task_link_id: string }>> {
    const result = await queryDataSource<{ id: string; task_link_id: string }>(
      this.dataSource,
      `
        WITH latest AS (
          SELECT vws.id,
                 vws.task_link_id,
                 COALESCE(
                   (SELECT MAX(p.recorded_at) FROM visit_position_pings p WHERE p.session_id = vws.id),
                   vws.started_at
                 ) AS last_activity_at
          FROM visit_work_sessions vws
          WHERE vws.ended_at IS NULL
        )
        UPDATE visit_work_sessions vws
        SET ended_at = now(), end_reason = 'TIMEOUT', updated_at = now()
        FROM latest
        WHERE vws.id = latest.id AND latest.last_activity_at < $1
        RETURNING vws.id, vws.task_link_id
      `,
      [cutoff],
    );
    return result.rows;
  }

  async deletePingsOlderThan(cutoff: Date): Promise<number> {
    const result = await queryDataSource<{ id: string }>(
      this.dataSource,
      `DELETE FROM visit_position_pings WHERE recorded_at < $1 RETURNING id`,
      [cutoff],
    );
    return result.rows.length;
  }
}
