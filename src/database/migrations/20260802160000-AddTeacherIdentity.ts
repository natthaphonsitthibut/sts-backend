import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * Expand phase of splitting teacher identity out of `users`.
 *
 * Teachers stop being "a user row with role = TEACHER" and become their own
 * master-data record. Rationale:
 * - A teacher is school personnel, not a system account. Teachers sign in through
 *   scoped access links (`teacher_access_grants`), so they need no username,
 *   password or role — the reference screens for จัดการข้อมูลคุณครู carry neither.
 * - Their capabilities come from the grant on the link (classroom, subject, task,
 *   expiry), never from `users.role`.
 *
 * Deliberately NOT on `teachers`:
 * - `school_id` — affiliation and transfer history already live in
 *   `school_teacher_memberships`, which is temporal (started_on/ended_on). Putting
 *   a school on the person would duplicate that and immediately drift.
 *
 * `linked_user_id` is nullable and optional: it exists for legacy rows and for the
 * case where the same person is also an executive/director with a real account.
 *
 * This migration only expands (steps 1-4 of the agreed plan). `teacher_user_id`
 * and the `TEACHER` role stay in place and keep working until the read/write paths
 * are switched over; a later contract migration retires them.
 */
const TEACHER_PERMISSION = 'manage-teachers';
const TEACHER_PERMISSION_ROLES = ['ADMIN', 'DIRECTOR'] as const;

export class AddTeacherIdentity20260802160000 implements MigrationInterface {
  name = 'AddTeacherIdentity20260802160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Teacher master data.
    await queryRunner.query(`
      CREATE TABLE teachers (
        id BIGSERIAL PRIMARY KEY,
        first_name VARCHAR(120) NOT NULL,
        last_name VARCHAR(120) NOT NULL,
        citizen_id CHAR(13),
        phone VARCHAR(10),
        email VARCHAR(255),
        line_id VARCHAR(64),
        photo_storage_key VARCHAR(255),
        teacher_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
        linked_user_id INTEGER,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT fk_teachers_linked_user
          FOREIGN KEY (linked_user_id) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_teachers_first_name CHECK (length(btrim(first_name)) > 0),
        CONSTRAINT chk_teachers_last_name CHECK (length(btrim(last_name)) > 0),
        CONSTRAINT chk_teachers_citizen_id CHECK (citizen_id ~ '^[0-9]{13}$'),
        CONSTRAINT chk_teachers_phone CHECK (phone ~ '^[0-9]{9,10}$'),
        CONSTRAINT chk_teachers_email CHECK (position('@' IN email) > 1),
        CONSTRAINT chk_teachers_status
          CHECK (teacher_status IN ('ACTIVE', 'INACTIVE'))
      );
      ${auditUpdatedAtTriggerSql('teachers')}

      CREATE UNIQUE INDEX uq_teachers_citizen_id
        ON teachers (citizen_id)
        WHERE citizen_id IS NOT NULL AND deleted_at IS NULL;
      CREATE UNIQUE INDEX uq_teachers_linked_user
        ON teachers (linked_user_id)
        WHERE linked_user_id IS NOT NULL AND deleted_at IS NULL;
      CREATE INDEX idx_teachers_name
        ON teachers (last_name, first_name)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_teachers_status
        ON teachers (teacher_status)
        WHERE deleted_at IS NULL;
    `);

    // 2. Backfill: every account that is either flagged TEACHER or already carries
    //    a school membership becomes a teacher record, linked back to its account.
    //    Names fall back to the username so the NOT NULL / non-blank checks hold
    //    for accounts that never filled in a real name.
    await queryRunner.query(`
      INSERT INTO teachers (
        first_name,
        last_name,
        citizen_id,
        phone,
        email,
        line_id,
        teacher_status,
        linked_user_id
      )
      SELECT
        COALESCE(NULLIF(btrim(source."FirstName"), ''), source.username),
        COALESCE(NULLIF(btrim(source."LastName"), ''), '-'),
        CASE
          WHEN btrim(COALESCE(source."PersonID_Onec", '')) ~ '^[0-9]{13}$'
          THEN btrim(source."PersonID_Onec")
        END,
        CASE
          WHEN btrim(COALESCE(source.phone, '')) ~ '^[0-9]{9,10}$'
          THEN btrim(source.phone)
        END,
        CASE
          WHEN position('@' IN btrim(COALESCE(source.email, ''))) > 1
          THEN btrim(source.email)
        END,
        NULLIF(btrim(COALESCE(source.line_id, '')), ''),
        CASE WHEN source.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
        source.id
      FROM (
        SELECT DISTINCT ON (account.id) account.*
        FROM users account
        LEFT JOIN school_teacher_memberships membership
          ON membership.teacher_user_id = account.id
         AND membership.deleted_at IS NULL
        WHERE account.role = 'TEACHER' OR membership.id IS NOT NULL
        ORDER BY account.id
      ) source;
    `);

    // Two legacy accounts can share one national id; the partial unique index above
    // would have rejected the second insert. Nothing to do here — the CASE above
    // only copies well-formed ids, and duplicates surface as a migration failure
    // rather than silently merging two people into one teacher.

    // 3. Point memberships at the teacher record instead of the account.
    await queryRunner.query(`
      ALTER TABLE school_teacher_memberships ADD COLUMN teacher_id BIGINT;

      UPDATE school_teacher_memberships membership
      SET teacher_id = teacher.id
      FROM teachers teacher
      WHERE teacher.linked_user_id = membership.teacher_user_id;

      ALTER TABLE school_teacher_memberships
        ALTER COLUMN teacher_id SET NOT NULL,
        ADD CONSTRAINT fk_school_teacher_memberships_teacher
          FOREIGN KEY (teacher_id) REFERENCES teachers(id)
          ON DELETE RESTRICT ON UPDATE CASCADE;

      CREATE UNIQUE INDEX uq_school_teacher_memberships_active_teacher
        ON school_teacher_memberships (school_id, teacher_id)
        WHERE membership_status = 'ACTIVE' AND deleted_at IS NULL;
      CREATE INDEX idx_school_teacher_memberships_teacher_id
        ON school_teacher_memberships (teacher_id, membership_status)
        WHERE deleted_at IS NULL;
    `);

    // 4. Timetable slots reference the membership, not the account, so the school
    //    of the slot and the school of the teacher can no longer disagree — the
    //    composite FK makes that a database-level guarantee.
    await queryRunner.query(`
      ALTER TABLE timetable_slots ADD COLUMN teacher_membership_id BIGINT;

      UPDATE timetable_slots slot
      SET teacher_membership_id = membership.id
      FROM school_teacher_memberships membership
      WHERE membership.school_id = slot.school_id
        AND membership.teacher_user_id = slot.teacher_user_id
        AND membership.membership_status = 'ACTIVE'
        AND membership.deleted_at IS NULL;

      ALTER TABLE timetable_slots
        ADD CONSTRAINT fk_timetable_slots_teacher_membership_school
          FOREIGN KEY (teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE;

      CREATE INDEX idx_timetable_slots_teacher_membership
        ON timetable_slots (teacher_membership_id)
        WHERE deleted_at IS NULL AND teacher_membership_id IS NOT NULL;
    `);

    // 5. Staff accounts carry a profile photo too (the จัดการผู้ใช้งาน form), served
    //    through the same guarded-endpoint + signed-URL path as every other image.
    await queryRunner.query(`
      ALTER TABLE users ADD COLUMN photo_storage_key VARCHAR(255);
    `);

    // 6. Grant the new permission that gates จัดการข้อมูลคุณครู. Accounts that
    //    already manage the school structure keep managing teachers, so nobody
    //    loses access to a roster they were maintaining before the split.
    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions || $1::jsonb
        WHERE name = ANY($2::text[])
          AND NOT (default_permissions ? $3)
      `,
      [JSON.stringify([TEACHER_PERMISSION]), TEACHER_PERMISSION_ROLES, TEACHER_PERMISSION],
    );
    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions || $1::jsonb
        WHERE jsonb_typeof(permissions) = 'array'
          AND permissions ? 'manage-school-structure'
          AND NOT (permissions ? $2)
      `,
      [JSON.stringify([TEACHER_PERMISSION]), TEACHER_PERMISSION],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE users SET permissions = permissions - $1`, [
      TEACHER_PERMISSION,
    ]);
    await queryRunner.query(`UPDATE roles SET default_permissions = default_permissions - $1`, [
      TEACHER_PERMISSION,
    ]);

    await queryRunner.query(`
      ALTER TABLE users DROP COLUMN IF EXISTS photo_storage_key;

      DROP INDEX IF EXISTS idx_timetable_slots_teacher_membership;
      ALTER TABLE timetable_slots
        DROP CONSTRAINT IF EXISTS fk_timetable_slots_teacher_membership_school;
      ALTER TABLE timetable_slots DROP COLUMN IF EXISTS teacher_membership_id;

      DROP INDEX IF EXISTS idx_school_teacher_memberships_teacher_id;
      DROP INDEX IF EXISTS uq_school_teacher_memberships_active_teacher;
      ALTER TABLE school_teacher_memberships
        DROP CONSTRAINT IF EXISTS fk_school_teacher_memberships_teacher;
      ALTER TABLE school_teacher_memberships DROP COLUMN IF EXISTS teacher_id;

      DROP TRIGGER IF EXISTS trg_teachers_set_updated_at ON teachers;
      DROP TABLE IF EXISTS teachers;
    `);
  }
}
