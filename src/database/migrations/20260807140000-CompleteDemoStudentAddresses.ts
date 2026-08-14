import type { MigrationInterface, QueryRunner } from 'typeorm';

const DEMO_REASON = 'ข้อมูลสาธิตสำหรับการนำเสนอวงจรติดตามนักเรียน';
const SCHOOL_NAME = 'โรงเรียนเทพศิรินทร์ราชดำริ';

/**
 * Completes the one-time showcase address data without overwriting imported or
 * manually edited values. The deterministic UUID seed keeps generated values
 * stable across environments and repeated migration verification runs.
 */
export class CompleteDemoStudentAddresses20260807140000 implements MigrationInterface {
  name = 'CompleteDemoStudentAddresses20260807140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      WITH student_seed AS (
        SELECT
          source.student_uuid,
          ('x' || SUBSTRING(MD5(source.student_uuid::text), 1, 8))::bit(32)::bigint AS hash_value
        FROM student_term source
      )
      UPDATE student_term student
      SET
        address_house_no = COALESCE(
          NULLIF(BTRIM(student.address_house_no), ''),
          (1 + (seed.hash_value % 199))::text || '/' || (1 + ((seed.hash_value / 199) % 19))::text
        ),
        "VillageNumber_Onec" = COALESCE(
          NULLIF(BTRIM(student."VillageNumber_Onec"), ''),
          (1 + (seed.hash_value % 12))::text
        ),
        "Street_Onec" = COALESCE(
          NULLIF(BTRIM(student."Street_Onec"), ''),
          'ถนน' || COALESCE(NULLIF(BTRIM(school.district), ''), 'สายหลัก')
        ),
        "Soi_Onec" = CASE
          WHEN NULLIF(BTRIM(student."Soi_Onec"), '') IS NULL
            OR BTRIM(student."Soi_Onec") = 'ซอยใกล้โรงเรียน'
          THEN 'ซอยร่วมใจ ' || (1 + ((seed.hash_value / 17) % 24))::text
          ELSE student."Soi_Onec"
        END,
        "Trok_Onec" = COALESCE(
          NULLIF(BTRIM(student."Trok_Onec"), ''),
          'ตรอกพัฒนา ' || (1 + ((seed.hash_value / 29) % 12))::text
        ),
        "ProvinceNameThai_Onec" = COALESCE(
          NULLIF(BTRIM(student."ProvinceNameThai_Onec"), ''),
          NULLIF(BTRIM(school.province), '')
        ),
        "DistrictNameThai_Onec" = COALESCE(
          NULLIF(BTRIM(student."DistrictNameThai_Onec"), ''),
          NULLIF(BTRIM(school.district), '')
        ),
        "SubDistrictNameThai_Onec" = COALESCE(
          NULLIF(BTRIM(student."SubDistrictNameThai_Onec"), ''),
          NULLIF(BTRIM(school.sub_district), '')
        ),
        "PostalCode_Onec" = NULLIF(BTRIM(student."PostalCode_Onec"), '')
      FROM schools school, student_seed seed
      WHERE school.id = student."SchoolID_Onec"
        AND school.name = $1
        AND seed.student_uuid = student.student_uuid
        AND student.deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM users demo_actor
          JOIN school_teacher_memberships demo_membership
            ON demo_membership.teacher_user_id = demo_actor.id
           AND demo_membership.school_id = school.id
           AND demo_membership.membership_status = 'ACTIVE'
           AND demo_membership.deleted_at IS NULL
          WHERE demo_actor.data_origin_code = 'DEMO'
            AND demo_actor.status = 'ACTIVE'
        )
        AND (
          NULLIF(BTRIM(student.address_house_no), '') IS NULL
          OR NULLIF(BTRIM(student."VillageNumber_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."Street_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."Soi_Onec"), '') IS NULL
          OR BTRIM(student."Soi_Onec") = 'ซอยใกล้โรงเรียน'
          OR NULLIF(BTRIM(student."Trok_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."ProvinceNameThai_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."DistrictNameThai_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."SubDistrictNameThai_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."PostalCode_Onec"), '') IS NULL
        )
    `,
      [SCHOOL_NAME],
    );

    await queryRunner.query(
      `
        WITH source_address AS (
          SELECT
            student.student_uuid,
            NULLIF(BTRIM(student."FirstName_Onec"), '') AS first_name,
            NULLIF(BTRIM(student."LastName_Onec"), '') AS last_name,
            CONCAT_WS(
              ' ',
              NULLIF(BTRIM(student.address_house_no), ''),
              CASE
                WHEN NULLIF(BTRIM(student."VillageNumber_Onec"), '') IS NULL THEN NULL
                WHEN BTRIM(student."VillageNumber_Onec") LIKE 'หมู่%' THEN BTRIM(student."VillageNumber_Onec")
                ELSE 'หมู่ ' || BTRIM(student."VillageNumber_Onec")
              END,
              CASE
                WHEN NULLIF(BTRIM(student."Trok_Onec"), '') IS NULL THEN NULL
                WHEN BTRIM(student."Trok_Onec") LIKE 'ตรอก%' THEN BTRIM(student."Trok_Onec")
                ELSE 'ตรอก' || BTRIM(student."Trok_Onec")
              END,
              CASE
                WHEN NULLIF(BTRIM(student."Soi_Onec"), '') IS NULL THEN NULL
                WHEN BTRIM(student."Soi_Onec") LIKE 'ซอย%' THEN BTRIM(student."Soi_Onec")
                ELSE 'ซอย' || BTRIM(student."Soi_Onec")
              END,
              CASE
                WHEN NULLIF(BTRIM(student."Street_Onec"), '') IS NULL THEN NULL
                WHEN BTRIM(student."Street_Onec") LIKE 'ถนน%' THEN BTRIM(student."Street_Onec")
                ELSE 'ถนน' || BTRIM(student."Street_Onec")
              END
            ) AS address_line,
            NULLIF(BTRIM(student."ProvinceNameThai_Onec"), '') AS province,
            NULLIF(BTRIM(student."DistrictNameThai_Onec"), '') AS district,
            NULLIF(BTRIM(student."SubDistrictNameThai_Onec"), '') AS sub_district,
            NULLIF(BTRIM(student."PostalCode_Onec"), '') AS postal_code
          FROM student_term student
          WHERE student.deleted_at IS NULL
        ),
        complete_address AS (
          SELECT
            source_address.*,
            CONCAT_WS(
              ' ',
              source_address.address_line,
              source_address.sub_district,
              source_address.district,
              source_address.province,
              source_address.postal_code
            ) AS full_address
          FROM source_address
        )
        UPDATE cases tracked_case
        SET
          student_first_name = COALESCE(NULLIF(BTRIM(tracked_case.student_first_name), ''), source.first_name),
          student_last_name = COALESCE(NULLIF(BTRIM(tracked_case.student_last_name), ''), source.last_name),
          student_address = COALESCE(NULLIF(BTRIM(tracked_case.student_address), ''), source.full_address),
          address_line = COALESCE(NULLIF(BTRIM(tracked_case.address_line), ''), source.address_line),
          address_province = COALESCE(NULLIF(BTRIM(tracked_case.address_province), ''), source.province),
          address_district = COALESCE(NULLIF(BTRIM(tracked_case.address_district), ''), source.district),
          address_sub_district = COALESCE(NULLIF(BTRIM(tracked_case.address_sub_district), ''), source.sub_district),
          postal_code = COALESCE(NULLIF(BTRIM(tracked_case.postal_code), ''), source.postal_code)
        FROM complete_address source
        WHERE tracked_case.student_uuid = source.student_uuid
          AND tracked_case.reason_flagged = $1
          AND tracked_case.student_school = $2
          AND tracked_case.deleted_at IS NULL
      `,
      [DEMO_REASON, SCHOOL_NAME],
    );
  }

  /**
   * This migration only fills missing demo values. Automatically clearing them
   * could erase data edited after deployment, so rollback intentionally leaves
   * the populated address data in place.
   */
  public async down(): Promise<void> {}
}
