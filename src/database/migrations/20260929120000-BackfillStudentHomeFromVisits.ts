import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A home visit that found the student at a new address only moved the pin; the
 * student record kept the old address text until the submit path started
 * writing it through. This carries each student's latest reported move into
 * their record, the same way a new submission now does: the free street line
 * lands in the house-number column, the other street parts clear, and the pin
 * comes along only when the visit had one.
 *
 * A row is left alone when it already matches, or when it was edited after
 * that visit — a later manual correction wins over an older report.
 *
 * Data only. `down()` is a no-op: the old text was the address the visit
 * reported the student had moved away from.
 */
export class BackfillStudentHomeFromVisits20260929120000 implements MigrationInterface {
  name = 'BackfillStudentHomeFromVisits20260929120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH latest_move AS (
        SELECT DISTINCT ON (c.student_uuid)
          c.student_uuid,
          s.submitted_at,
          btrim(s.updated_address_line) AS address_line,
          btrim(s.updated_address_sub_district) AS sub_district,
          btrim(s.updated_address_district) AS district,
          btrim(s.updated_address_province) AS province,
          s.updated_postal_code AS postal_code,
          COALESCE(s.updated_lat, s.visit_lat) AS lat,
          COALESCE(s.updated_lng, s.visit_lng) AS lng
        FROM task_submissions s
        JOIN task_links l ON l.id = s.task_link_id
        JOIN tasks t ON t.id = l.task_id
        JOIN cases c ON c.id = t.case_id
        WHERE s.home_visit_exception_code = 'ADDRESS_CHANGED'
          AND c.student_uuid IS NOT NULL
        ORDER BY c.student_uuid, s.submitted_at DESC
      )
      UPDATE student_term st
      SET address_house_no = m.address_line,
          "VillageNumber_Onec" = NULL,
          "Trok_Onec" = NULL,
          "Soi_Onec" = NULL,
          "Street_Onec" = NULL,
          "SubDistrictNameThai_Onec" = m.sub_district,
          "DistrictNameThai_Onec" = m.district,
          "ProvinceNameThai_Onec" = m.province,
          "PostalCode_Onec" = m.postal_code,
          address_latitude = CASE WHEN m.lat IS NOT NULL AND m.lng IS NOT NULL
            THEN m.lat ELSE st.address_latitude END,
          address_longitude = CASE WHEN m.lat IS NOT NULL AND m.lng IS NOT NULL
            THEN m.lng ELSE st.address_longitude END,
          updated_at = now()
      FROM latest_move m
      WHERE st.student_uuid = m.student_uuid
        AND st.deleted_at IS NULL
        AND st.updated_at <= m.submitted_at + interval '1 minute'
        AND (
          st.address_house_no IS DISTINCT FROM m.address_line
          OR st."SubDistrictNameThai_Onec" IS DISTINCT FROM m.sub_district
          OR st."DistrictNameThai_Onec" IS DISTINCT FROM m.district
          OR st."ProvinceNameThai_Onec" IS DISTINCT FROM m.province
          OR st."PostalCode_Onec" IS DISTINCT FROM m.postal_code
        )
    `);
  }

  public down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    return Promise.resolve();
  }
}
