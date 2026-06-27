import type { MigrationInterface, QueryRunner } from 'typeorm';

const ADMIN_STUDENT_ACCOUNT_ROLES = [
  'ADMIN',
  'ADMIN_PROVINCE',
  'ADMIN_DISTRICT',
  'ADMIN_SUBDISTRICT',
  'ADMIN_SCHOOL',
] as const;

export class AddStudentAccountLink20260627130000 implements MigrationInterface {
  name = 'AddStudentAccountLink20260627130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS person_uuid UUID
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_person'
        ) THEN
          ALTER TABLE users
            ADD CONSTRAINT fk_users_person
            FOREIGN KEY (person_uuid) REFERENCES student_person(person_uuid)
            ON DELETE RESTRICT;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_users_person_uuid ON users (person_uuid)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_users_active_student_person
        ON users (person_uuid)
        WHERE person_uuid IS NOT NULL AND role = 'STUDENT' AND status = 'ACTIVE'
    `);
    for (const role of ADMIN_STUDENT_ACCOUNT_ROLES) {
      await queryRunner.query(
        `
          UPDATE roles
          SET default_permissions = default_permissions || '["manage-student-accounts"]'::jsonb
          WHERE name = $1
            AND NOT default_permissions ? 'manage-student-accounts'
        `,
        [role],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const role of ADMIN_STUDENT_ACCOUNT_ROLES) {
      await queryRunner.query(
        `
          UPDATE roles
          SET default_permissions = COALESCE(
            (
              SELECT jsonb_agg(permission ORDER BY ord)
              FROM jsonb_array_elements_text(default_permissions) WITH ORDINALITY AS p(permission, ord)
              WHERE permission <> 'manage-student-accounts'
            ),
            '[]'::jsonb
          )
          WHERE name = $1
        `,
        [role],
      );
    }
    await queryRunner.query(`DROP INDEX IF EXISTS uq_users_active_student_person`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_person_uuid`);
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_person`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS person_uuid`);
  }
}
