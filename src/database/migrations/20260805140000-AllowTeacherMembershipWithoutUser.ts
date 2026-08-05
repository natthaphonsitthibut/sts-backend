import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Finishes the expand phase of the teacher identity split.
 *
 * `AddTeacherIdentity20260802160000` made `teacher_id` the real identity and
 * `ResolveTeacherMembershipIdentity20260802170000` added a trigger so legacy
 * writers that only know `teacher_user_id` keep working. What neither did was
 * relax `teacher_user_id` itself, so the new writer — which creates a teacher
 * with no login account and passes NULL — fails on the NOT NULL constraint:
 * `POST /api/teachers` could not succeed even once.
 *
 * The invariant "a membership must identify a teacher somehow" is already
 * enforced by that trigger, which rejects a row with neither column set, so
 * dropping NOT NULL here does not let orphan rows in.
 */
export class AllowTeacherMembershipWithoutUser20260805140000 implements MigrationInterface {
  name = 'AllowTeacherMembershipWithoutUser20260805140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE school_teacher_memberships
        ALTER COLUMN teacher_user_id DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Refuse rather than fail cryptically: teachers created without a login
    // account are real records, and deciding what happens to them is the
    // operator's call, not this migration's.
    const rows = (await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM school_teacher_memberships
      WHERE teacher_user_id IS NULL
    `)) as unknown as Array<{ count: number }>;
    const orphanCount = Number(rows[0]?.count ?? 0);
    if (orphanCount > 0) {
      throw new Error(
        `Cannot restore NOT NULL on school_teacher_memberships.teacher_user_id: ` +
          `${orphanCount} membership(s) have no linked user account. ` +
          `Link or remove those teachers before rolling back.`,
      );
    }
    await queryRunner.query(`
      ALTER TABLE school_teacher_memberships
        ALTER COLUMN teacher_user_id SET NOT NULL
    `);
  }
}
