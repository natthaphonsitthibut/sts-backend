import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Last of the student-login removal: the columns and defaults that only made
 * sense while a student could hold an account.
 *
 * 1. `users.role` still defaulted to `'TEACHER'` — a role deleted in
 *    20260823120000. The column is NOT NULL with a foreign key to `roles(name)`,
 *    so any INSERT that omitted `role` stopped working the moment that role went
 *    away: the default filled in a name the foreign key then refused. Every
 *    writer in the codebase names the column explicitly, so the default is not
 *    replaced with another role — it is removed, and an insert that forgets the
 *    role now fails on the NOT NULL that means it.
 *
 * 2. `users.person_uuid` linked an account to the person it belonged to. That is
 *    what a student account was; staff accounts have never used it (0 rows carry
 *    a value). The unique index that enforced "one active account per student
 *    person" goes with it.
 *
 * `down()` restores the column, its foreign key and both indexes, and puts the
 * `'TEACHER'` default back only if that role exists again — reverting this
 * migration alone should not reintroduce a default that cannot satisfy the
 * foreign key.
 */
export class DropStudentAccountLinkage20260824090000 implements MigrationInterface {
  name = 'DropStudentAccountLinkage20260824090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ALTER COLUMN role DROP DEFAULT`);

    const linkedAccounts = (await queryRunner.query(`
      SELECT COUNT(*)::text AS count FROM users WHERE person_uuid IS NOT NULL
    `)) as Array<{ count: string }>;
    if (Number(linkedAccounts[0]?.count ?? 0) > 0) {
      throw new Error(
        `DropStudentAccountLinkage: ${linkedAccounts[0].count} accounts are still linked to a ` +
          'student person. Unlink them before running this migration.',
      );
    }

    await queryRunner.query(`DROP INDEX IF EXISTS uq_users_active_student_person`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_person_uuid`);
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_person`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN IF EXISTS person_uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS person_uuid UUID`);
    await queryRunner.query(`
      ALTER TABLE users
        ADD CONSTRAINT fk_users_person
        FOREIGN KEY (person_uuid) REFERENCES student_person(person_uuid)
        ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_users_person_uuid ON users (person_uuid)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_users_active_student_person
        ON users (person_uuid)
        WHERE person_uuid IS NOT NULL AND role = 'STUDENT' AND status = 'ACTIVE'
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM roles WHERE name = 'TEACHER') THEN
          ALTER TABLE users ALTER COLUMN role SET DEFAULT 'TEACHER';
        END IF;
      END $$
    `);
  }
}
