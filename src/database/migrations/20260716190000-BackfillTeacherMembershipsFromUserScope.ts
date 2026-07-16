import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillTeacherMembershipsFromUserScope20260716190000 implements MigrationInterface {
  name = 'BackfillTeacherMembershipsFromUserScope20260716190000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE teacher_membership_scope_backfill_20260716_backup (
        membership_id BIGINT PRIMARY KEY
          REFERENCES school_teacher_memberships(id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(`
      WITH scoped_teachers AS (
        SELECT DISTINCT
          teacher.id AS teacher_user_id,
          school.id AS school_id
        FROM users teacher
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(teacher.data_scope -> 'school_ids') = 'array'
              THEN teacher.data_scope -> 'school_ids'
            ELSE '[]'::jsonb
          END
        ) AS scoped_school(raw_school_id)
        JOIN schools school
          ON school.id = CASE
            WHEN scoped_school.raw_school_id ~ '^[0-9]+$'
              THEN scoped_school.raw_school_id::int
            ELSE NULL
          END
        WHERE teacher.status = 'ACTIVE'
          AND teacher.role = 'TEACHER'
      ), inserted AS (
        INSERT INTO school_teacher_memberships (
          school_id,
          teacher_user_id,
          membership_status,
          started_on
        )
        SELECT school_id, teacher_user_id, 'ACTIVE', CURRENT_DATE
        FROM scoped_teachers candidate
        WHERE NOT EXISTS (
          SELECT 1
          FROM school_teacher_memberships membership
          WHERE membership.school_id = candidate.school_id
            AND membership.teacher_user_id = candidate.teacher_user_id
            AND membership.membership_status = 'ACTIVE'
            AND membership.deleted_at IS NULL
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      )
      INSERT INTO teacher_membership_scope_backfill_20260716_backup (membership_id)
      SELECT id FROM inserted
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM school_teacher_memberships membership
      USING teacher_membership_scope_backfill_20260716_backup backup
      WHERE membership.id = backup.membership_id
    `);
    await queryRunner.query(`DROP TABLE teacher_membership_scope_backfill_20260716_backup`);
  }
}
