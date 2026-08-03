import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Teacher attendance links (task-teacher-attendance-link.md) replace the old
 * per-classroom ATTENDANCE task links. Two things the previous grant design
 * cannot express:
 *
 * 1. `token_encrypted` — the admin screen issues links in bulk and hands them
 *    out afterwards, so the raw token has to be redisplayable. Hash-only can
 *    show a link exactly once, at creation. This mirrors the decision already
 *    taken for `task_links.token_encrypted` (20260709130000): `token_hash`
 *    stays the credential that authenticates a request, and the ciphertext
 *    exists purely so the issuer can copy the link again. Nullable because
 *    grants issued before this migration have no recoverable plaintext — the
 *    UI offers "rotate" instead of "copy" for those.
 * 2. `SUBJECT_ATTENDANCE` capability — subject-period attendance is the primary
 *    attendance source (decision 2026-07-06) and a teacher's link now covers
 *    their subject classes, not just the homeroom they own.
 */
const LINK_PERMISSION = 'manage-teacher-access';
const LINK_PERMISSION_ROLES = ['ADMIN', 'DIRECTOR'] as const;

export class AddTeacherLinkRedisplayAndSubjectAttendance20260803140000 implements MigrationInterface {
  name = 'AddTeacherLinkRedisplayAndSubjectAttendance20260803140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE teacher_access_grants ADD COLUMN IF NOT EXISTS token_encrypted TEXT NULL;

      ALTER TABLE teacher_access_grant_capabilities
        DROP CONSTRAINT IF EXISTS chk_teacher_access_grant_capability;
      ALTER TABLE teacher_access_grant_capabilities
        ADD CONSTRAINT chk_teacher_access_grant_capability
        CHECK (capability IN ('HOMEROOM_ATTENDANCE', 'SUBJECT_ATTENDANCE', 'TEACHER_OBSERVATION'));
    `);

    // Teacher links must prove the recipient owns the mailbox before they can
    // read a roster, so the default policy moves off NONE now that the step-up
    // flow exists. Existing grants keep whatever policy they were issued with.
    await queryRunner.query(`
      UPDATE system_settings
      SET setting_value = 'EMAIL_OTP', updated_at = now()
      WHERE setting_key = 'TEACHER_ACCESS_DEFAULT_STEP_UP_POLICY'
        AND setting_value = 'NONE'
    `);

    // `manage-teacher-access` was retired in 20260802150000 when teachers were
    // expected to use ordinary accounts. Teachers are back on links (see the
    // teacher-identity split decision), so the permission that gates issuing
    // them comes back with it — for the same two roles that manage a school.
    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions || $1::jsonb
        WHERE name = ANY($2::text[])
          AND NOT (default_permissions ? $3)
      `,
      [JSON.stringify([LINK_PERMISSION]), LINK_PERMISSION_ROLES, LINK_PERMISSION],
    );
    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions || $1::jsonb
        WHERE jsonb_typeof(permissions) = 'array'
          AND permissions ? 'manage-school-structure'
          AND NOT (permissions ? $2)
      `,
      [JSON.stringify([LINK_PERMISSION]), LINK_PERMISSION],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE users SET permissions = permissions - $1`, [LINK_PERMISSION]);
    await queryRunner.query(`UPDATE roles SET default_permissions = default_permissions - $1`, [
      LINK_PERMISSION,
    ]);

    await queryRunner.query(`
      UPDATE system_settings
      SET setting_value = 'NONE', updated_at = now()
      WHERE setting_key = 'TEACHER_ACCESS_DEFAULT_STEP_UP_POLICY'
        AND setting_value = 'EMAIL_OTP';

      DELETE FROM teacher_access_grant_capabilities WHERE capability = 'SUBJECT_ATTENDANCE';
      ALTER TABLE teacher_access_grant_capabilities
        DROP CONSTRAINT IF EXISTS chk_teacher_access_grant_capability;
      ALTER TABLE teacher_access_grant_capabilities
        ADD CONSTRAINT chk_teacher_access_grant_capability
        CHECK (capability IN ('HOMEROOM_ATTENDANCE', 'TEACHER_OBSERVATION'));

      ALTER TABLE teacher_access_grants DROP COLUMN IF EXISTS token_encrypted;
    `);
  }
}
