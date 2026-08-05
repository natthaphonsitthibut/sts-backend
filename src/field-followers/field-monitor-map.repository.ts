import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { DataScope } from '../auth';
import { buildDataScopeQuery } from '../common/utils/authorization';
import { queryDataSource } from '../database/sql-query';
import type { FieldMonitorMapRow } from './field-monitor-map.types';

@Injectable()
export class FieldMonitorMapRepository {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Returns home pins for exactly the requested students, scope-filtered.
   * Students outside the actor's scope are silently dropped (fail-closed) —
   * the caller reports how many of the requested ids actually came back.
   */
  async getPins(studentUuids: string[], actorScope: DataScope): Promise<FieldMonitorMapRow[]> {
    const params: unknown[] = [studentUuids];
    const conditions: string[] = ['s.student_uuid = ANY($1::uuid[])'];

    const scopeResult = buildDataScopeQuery(
      actorScope,
      {
        school_id: `s."SchoolID_Onec"`,
        grade: `s."GradeLevelID_Onec"`,
        room: `s."RoomID_Onec"::text`,
        province: 'sc.province',
        district: 'sc.district',
        sub_district: 'sc.sub_district',
      },
      params.length + 1,
    );
    if (scopeResult.sql) {
      conditions.push(`(${scopeResult.sql})`);
      params.push(...scopeResult.params);
    }

    const result = await queryDataSource<FieldMonitorMapRow>(
      this.dataSource,
      `
        SELECT
          s.student_uuid,
          (s."FirstName_Onec" || ' ' || s."LastName_Onec") AS student_name,
          sc.name AS school_name,
          COALESCE(profile.risk_tier, 'NORMAL') AS risk_tier,
          -- Latest home-visit case pin wins when both exist (most recent
          -- on-the-ground observation); the student's own confirmed profile
          -- coordinate (set via the student edit form) is the next-best
          -- confirmed source before falling back to the geocode cache.
          COALESCE(latest_case.student_lat, s.address_latitude) AS student_lat,
          COALESCE(latest_case.student_lng, s.address_longitude) AS student_lng,
          s.address_house_no,
          s."VillageNumber_Onec",
          s."Trok_Onec",
          s."Soi_Onec",
          s."Street_Onec",
          s."SubDistrictNameThai_Onec",
          s."DistrictNameThai_Onec",
          s."ProvinceNameThai_Onec",
          s."PostalCode_Onec"
        FROM student_term s
        JOIN student_current_enrollment_resolution current_enrollment
          ON current_enrollment.person_uuid = s.person_uuid
         AND current_enrollment.selected_student_uuid = s.student_uuid
         AND current_enrollment.resolution_state = 'ACTIVE'
        LEFT JOIN schools sc ON s."SchoolID_Onec" = sc.id
        LEFT JOIN student_risk_profiles profile ON profile.student_uuid = s.student_uuid
        LEFT JOIN LATERAL (
          SELECT c.student_lat, c.student_lng
          FROM cases c
          WHERE c.student_uuid = s.student_uuid
            AND c.student_lat IS NOT NULL
            AND c.student_lng IS NOT NULL
            AND c.deleted_at IS NULL
          ORDER BY c.created_at DESC
          LIMIT 1
        ) latest_case ON true
        WHERE ${conditions.join(' AND ')}
      `,
      params,
    );

    return result.rows;
  }
}
