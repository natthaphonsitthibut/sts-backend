import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the `TEACHER` role row.
 *
 * Teachers stopped having accounts in 20260823120000, which left the row behind
 * marked unassignable with no permissions. The comment kept next to it said the
 * row had to stay because 991k attendance records name it — that stopped being
 * true in the same round, when attendance moved to `recorded_by_teacher_id` and
 * the identity became a `teachers` row. Nothing points at the role now, and the
 * development databases have already dropped it by hand, so a fresh install was
 * the only place still creating a role no code path can use.
 *
 * The delete is refused rather than cascaded if an account still carries it: that
 * would mean a teacher login exists again, which is the thing being prevented.
 */
export class DropRetiredTeacherRole20260825150000 implements MigrationInterface {
  name = 'DropRetiredTeacherRole20260825150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const attached = (await queryRunner.query(`
      SELECT COUNT(*)::int AS count FROM users WHERE role = 'TEACHER'
    `)) as Array<{ count: number }>;
    if (attached[0]?.count > 0) {
      throw new Error(
        `DropRetiredTeacherRole: ${attached[0].count} account(s) still carry the TEACHER role. ` +
          `Move them to a menu group first — a teacher is a row in teachers, not a login.`,
      );
    }
    await queryRunner.query(`DELETE FROM roles WHERE name = 'TEACHER'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO roles (name, label, default_permissions, scope_mode, scope_policy,
                         is_assignable, is_system)
      VALUES ('TEACHER', 'คุณครู', '[]'::jsonb, 'flexible', 'OWN_ONLY', FALSE, TRUE)
      ON CONFLICT (name) DO NOTHING
    `);
  }
}
