import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A delegated attendance link has a narrower boundary than a normal teacher
 * link: one existing classroom assignment, one Bangkok attendance date and one
 * access window.  It intentionally keeps the source assignment separate from
 * the recipient membership on the grant, so assigning a substitute does not
 * accidentally expose that substitute's other classrooms.
 */
export class AddRestrictedAttendanceDelegationGrants20260815180000 implements MigrationInterface {
  name = 'AddRestrictedAttendanceDelegationGrants20260815180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE teacher_access_grants
        ADD COLUMN access_scope VARCHAR(24) NOT NULL DEFAULT 'FULL';
      ALTER TABLE teacher_access_grants
        ADD CONSTRAINT chk_teacher_access_grants_access_scope
        CHECK (access_scope IN ('FULL', 'ATTENDANCE_ONLY'));
    `);
    await queryRunner.query(`
      CREATE TABLE teacher_access_attendance_assignments (
        grant_id UUID PRIMARY KEY,
        assignment_id BIGINT NOT NULL,
        assignment_teacher_membership_id BIGINT NOT NULL,
        school_id INTEGER NOT NULL,
        school_term_id BIGINT NOT NULL,
        classroom_id BIGINT NOT NULL,
        attendance_date DATE NOT NULL,
        starts_at TIMESTAMPTZ NOT NULL,
        ends_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_teacher_access_attendance_assignments_grant
          FOREIGN KEY (grant_id) REFERENCES teacher_access_grants(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_access_attendance_assignments_assignment_scope
          FOREIGN KEY (assignment_id, assignment_teacher_membership_id, school_id, classroom_id)
          REFERENCES classroom_teacher_assignments(id, teacher_membership_id, school_id, classroom_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_teacher_access_attendance_assignments_classroom_term
          FOREIGN KEY (classroom_id, school_term_id, school_id)
          REFERENCES school_classrooms(id, school_term_id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_teacher_access_attendance_assignments_window
          CHECK (ends_at > starts_at)
      );
      CREATE INDEX idx_teacher_access_attendance_assignments_window
        ON teacher_access_attendance_assignments (school_id, attendance_date, starts_at, ends_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS teacher_access_attendance_assignments;
      ALTER TABLE teacher_access_grants
        DROP CONSTRAINT IF EXISTS chk_teacher_access_grants_access_scope;
      ALTER TABLE teacher_access_grants
        DROP COLUMN IF EXISTS access_scope;
    `);
  }
}
