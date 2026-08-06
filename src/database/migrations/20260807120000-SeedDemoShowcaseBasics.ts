import type { MigrationInterface, QueryRunner } from 'typeorm';
import { STUDENT_TERM_POSTAL_CODE_BACKFILL_SQL } from '../bootstrap-sql';

/**
 * One-time demo-data migration for environments whose deployment platform
 * cannot run an interactive post-deploy shell command.  It fills only blank
 * student address fields and assigns only teachers with no membership at all.
 */
export class SeedDemoShowcaseBasics20260807120000 implements MigrationInterface {
  name = 'SeedDemoShowcaseBasics20260807120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE student_term student
      SET
        "ProvinceNameThai_Onec" = COALESCE(NULLIF(BTRIM(student."ProvinceNameThai_Onec"), ''), school.province),
        "DistrictNameThai_Onec" = COALESCE(NULLIF(BTRIM(student."DistrictNameThai_Onec"), ''), school.district),
        "SubDistrictNameThai_Onec" = COALESCE(NULLIF(BTRIM(student."SubDistrictNameThai_Onec"), ''), school.sub_district),
        "VillageNumber_Onec" = COALESCE(NULLIF(BTRIM(student."VillageNumber_Onec"), ''), '1'),
        "Street_Onec" = COALESCE(NULLIF(BTRIM(student."Street_Onec"), ''), 'ถนน' || COALESCE(NULLIF(BTRIM(school.district), ''), 'ในพื้นที่โรงเรียน')),
        "Soi_Onec" = COALESCE(NULLIF(BTRIM(student."Soi_Onec"), ''), 'ซอยใกล้โรงเรียน'),
        "PostalCode_Onec" = NULLIF(BTRIM(student."PostalCode_Onec"), '')
      FROM schools school
      WHERE school.id = student."SchoolID_Onec"
        AND student.deleted_at IS NULL
        AND (
          NULLIF(BTRIM(student."ProvinceNameThai_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."DistrictNameThai_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."SubDistrictNameThai_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."VillageNumber_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."Street_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."Soi_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."PostalCode_Onec"), '') IS NULL
        )
    `);
    await queryRunner.query(STUDENT_TERM_POSTAL_CODE_BACKFILL_SQL);

    const targets = (await queryRunner.query(`
      SELECT classroom.id AS classroom_id, classroom.school_id, slot.subject_id,
             slot.id AS timetable_slot_id
      FROM school_classrooms classroom
      JOIN timetable_slots slot
        ON slot.classroom_id = classroom.id
       AND slot.deleted_at IS NULL
      WHERE classroom.deleted_at IS NULL
      ORDER BY classroom.school_id, classroom.id, slot.day_of_week, slot.period
      LIMIT 1
    `)) as Array<{
      classroom_id: number;
      school_id: number;
      subject_id: number;
      timetable_slot_id: number;
    }>;
    const target = targets[0];
    if (!target) return;

    const teachers = (await queryRunner.query(`
      SELECT user_account.id
      FROM users user_account
      WHERE user_account.role = 'TEACHER'
        AND user_account.status = 'ACTIVE'
        AND NOT EXISTS (
          SELECT 1
          FROM school_teacher_memberships membership
          WHERE membership.teacher_user_id = user_account.id
            AND membership.deleted_at IS NULL
        )
    `)) as Array<{ id: number }>;
    for (const teacher of teachers) {
      const memberships = (await queryRunner.query(
        `
          INSERT INTO school_teacher_memberships (school_id, teacher_user_id, membership_status)
          VALUES ($1, $2, 'ACTIVE')
          RETURNING id
        `,
        [target.school_id, teacher.id],
      )) as Array<{ id: number }>;
      const membership = memberships[0];
      if (!membership) continue;
      await queryRunner.query(
        `
          INSERT INTO classroom_teacher_assignments
            (school_id, classroom_id, teacher_membership_id, subject_id, assignment_kind, assignment_status)
          VALUES ($1, $2, $3, $4, 'SUBJECT', 'ACTIVE')
          ON CONFLICT DO NOTHING
        `,
        [target.school_id, target.classroom_id, membership.id, target.subject_id],
      );
      await queryRunner.query(
        `
          INSERT INTO timetable_slot_teachers (timetable_slot_id, teacher_membership_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [target.timetable_slot_id, membership.id],
      );
    }
  }

  /** Data may have been used after migration, so removing it automatically is unsafe. */
  public async down(): Promise<void> {}
}
