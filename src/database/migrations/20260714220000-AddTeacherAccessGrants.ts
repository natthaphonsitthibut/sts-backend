import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Teacher links are reusable access grants, not one-off task links. Keeping the
 * lifecycle separate prevents task completion/OTP state from weakening grant
 * revocation and assignment checks.
 */
export class AddTeacherAccessGrants20260714220000 implements MigrationInterface {
  name = 'AddTeacherAccessGrants20260714220000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE EXTENSION IF NOT EXISTS pgcrypto;

      INSERT INTO system_settings (setting_key, setting_value, description)
      VALUES
        (
          'TEACHER_ACCESS_DEFAULT_EXPIRY_POLICY',
          'TERM_END',
          'นโยบายวันหมดอายุเริ่มต้นของลิงก์ครูเมื่อผู้ดูแลไม่ระบุวันหมดอายุเอง'
        ),
        (
          'TEACHER_ACCESS_DEFAULT_STEP_UP_POLICY',
          'NONE',
          'นโยบายยืนยันตัวตนเพิ่มสำหรับลิงก์ครู'
        )
      ON CONFLICT (setting_key) DO NOTHING;

      ALTER TABLE school_classrooms
        ADD CONSTRAINT uq_school_classrooms_id_term_school
        UNIQUE (id, school_term_id, school_id);
      ALTER TABLE classroom_teacher_assignments
        ADD CONSTRAINT uq_classroom_teacher_assignments_id_scope
        UNIQUE (id, teacher_membership_id, school_id, classroom_id);

      CREATE TABLE teacher_access_grants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        teacher_membership_id BIGINT NOT NULL,
        school_id INTEGER NOT NULL,
        school_term_id BIGINT NOT NULL,
        token_hash CHAR(64) NOT NULL,
        step_up_policy VARCHAR(24) NOT NULL DEFAULT 'NONE',
        issued_by INTEGER NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ,
        revoked_by INTEGER,
        revocation_reason VARCHAR(500),
        rotated_at TIMESTAMPTZ,
        rotation_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_teacher_access_grants_token_hash UNIQUE (token_hash),
        CONSTRAINT uq_teacher_access_grants_id_scope
          UNIQUE (id, teacher_membership_id, school_id, school_term_id),
        CONSTRAINT fk_teacher_access_grants_membership_school
          FOREIGN KEY (teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_access_grants_term_school
          FOREIGN KEY (school_term_id, school_id)
          REFERENCES school_terms(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_access_grants_issued_by
          FOREIGN KEY (issued_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_access_grants_revoked_by
          FOREIGN KEY (revoked_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_teacher_access_grants_token_hash
          CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT chk_teacher_access_grants_step_up
          CHECK (step_up_policy IN ('NONE', 'EMAIL_OTP', 'THAID')),
        CONSTRAINT chk_teacher_access_grants_validity
          CHECK (expires_at > issued_at),
        CONSTRAINT chk_teacher_access_grants_revocation
          CHECK (
            (revoked_at IS NULL AND revoked_by IS NULL AND revocation_reason IS NULL)
            OR (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
          ),
        CONSTRAINT chk_teacher_access_grants_rotation_count
          CHECK (rotation_count >= 0)
      );

      CREATE INDEX idx_teacher_access_grants_school_term
        ON teacher_access_grants (school_id, school_term_id, issued_at DESC);
      CREATE INDEX idx_teacher_access_grants_teacher
        ON teacher_access_grants (teacher_membership_id, issued_at DESC);
      CREATE INDEX idx_teacher_access_grants_active
        ON teacher_access_grants (expires_at, last_used_at)
        WHERE revoked_at IS NULL;

      CREATE TABLE teacher_access_grant_capabilities (
        grant_id UUID NOT NULL,
        capability VARCHAR(32) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_teacher_access_grant_capabilities PRIMARY KEY (grant_id, capability),
        CONSTRAINT fk_teacher_access_grant_capabilities_grant
          FOREIGN KEY (grant_id) REFERENCES teacher_access_grants(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT chk_teacher_access_grant_capability
          CHECK (capability IN ('HOMEROOM_ATTENDANCE', 'TEACHER_OBSERVATION'))
      );

      CREATE TABLE teacher_access_grant_assignments (
        grant_id UUID NOT NULL,
        assignment_id BIGINT NOT NULL,
        teacher_membership_id BIGINT NOT NULL,
        school_id INTEGER NOT NULL,
        school_term_id BIGINT NOT NULL,
        classroom_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_teacher_access_grant_assignments PRIMARY KEY (grant_id, assignment_id),
        CONSTRAINT fk_teacher_access_grant_assignments_grant_scope
          FOREIGN KEY (grant_id, teacher_membership_id, school_id, school_term_id)
          REFERENCES teacher_access_grants(id, teacher_membership_id, school_id, school_term_id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_access_grant_assignments_assignment_scope
          FOREIGN KEY (assignment_id, teacher_membership_id, school_id, classroom_id)
          REFERENCES classroom_teacher_assignments(id, teacher_membership_id, school_id, classroom_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_access_grant_assignments_classroom_term
          FOREIGN KEY (classroom_id, school_term_id, school_id)
          REFERENCES school_classrooms(id, school_term_id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
      CREATE INDEX idx_teacher_access_grant_assignments_assignment
        ON teacher_access_grant_assignments (assignment_id, grant_id);

    `);

    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions || $1::jsonb
        WHERE name = ANY($2::text[])
          AND NOT (default_permissions ? $3)
      `,
      [JSON.stringify(['manage-teacher-access']), ['ADMIN', 'DIRECTOR'], 'manage-teacher-access'],
    );
    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions || $1::jsonb
        WHERE jsonb_typeof(permissions) = 'array'
          AND permissions ? 'manage-school-structure'
          AND NOT (permissions ? $2)
      `,
      [JSON.stringify(['manage-teacher-access']), 'manage-teacher-access'],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE users SET permissions = permissions - 'manage-teacher-access'`);
    await queryRunner.query(
      `UPDATE roles SET default_permissions = default_permissions - 'manage-teacher-access'`,
    );
    await queryRunner.query(`
      DROP TABLE IF EXISTS teacher_access_grant_assignments;
      DROP TABLE IF EXISTS teacher_access_grant_capabilities;
      DROP TABLE IF EXISTS teacher_access_grants;
      ALTER TABLE classroom_teacher_assignments
        DROP CONSTRAINT IF EXISTS uq_classroom_teacher_assignments_id_scope;
      ALTER TABLE school_classrooms
        DROP CONSTRAINT IF EXISTS uq_school_classrooms_id_term_school;
      DELETE FROM system_settings
      WHERE setting_key IN (
        'TEACHER_ACCESS_DEFAULT_EXPIRY_POLICY',
        'TEACHER_ACCESS_DEFAULT_STEP_UP_POLICY'
      );
    `);
  }
}
