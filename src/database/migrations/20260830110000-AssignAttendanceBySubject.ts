import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * An assignment covers one subject, not a whole classroom.
 *
 * A teacher hands on the lesson they cannot take, not every lesson that room
 * has: assigning the room let whoever picked it up check in for colleagues who
 * were never asked. Pointing at `classroom_subjects` also names the classroom,
 * so nothing is lost — and it lets the link open straight onto that subject's
 * roster with no subject to choose.
 *
 * Assignments issued under the old shape are dropped rather than guessed at:
 * "which of this room's nine subjects did they mean" has no answer.
 */
export class AssignAttendanceBySubject20260830110000 implements MigrationInterface {
  name = 'AssignAttendanceBySubject20260830110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM classroom_attendance_links WHERE assigned_classroom_id IS NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        DROP CONSTRAINT chk_classroom_attendance_links_kind,
        DROP CONSTRAINT fk_classroom_attendance_links_assigned_classroom,
        DROP COLUMN assigned_classroom_id,
        ADD COLUMN assigned_classroom_subject_id BIGINT,
        ADD COLUMN assigned_classroom_id BIGINT,
        ADD CONSTRAINT fk_classroom_attendance_links_assigned_subject
          FOREIGN KEY (assigned_classroom_subject_id, assigned_classroom_id, school_id)
          REFERENCES classroom_subjects(id, classroom_id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_classroom_attendance_links_kind CHECK (
          (teacher_membership_id IS NOT NULL
           AND assigned_classroom_subject_id IS NULL AND assigned_classroom_id IS NULL
           AND expires_at IS NULL AND opens_at IS NULL)
          OR
          (teacher_membership_id IS NULL
           AND assigned_classroom_subject_id IS NOT NULL AND assigned_classroom_id IS NOT NULL
           AND expires_at IS NOT NULL)
        )
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_classroom_attendance_links_assignment;
      CREATE INDEX idx_classroom_attendance_links_assignment
        ON classroom_attendance_links
           (assigned_classroom_subject_id, school_id, expires_at DESC)
        WHERE assigned_classroom_subject_id IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM classroom_attendance_links WHERE assigned_classroom_subject_id IS NOT NULL`,
    );
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_classroom_attendance_links_assignment;
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_attendance_links
        DROP CONSTRAINT chk_classroom_attendance_links_kind,
        DROP CONSTRAINT fk_classroom_attendance_links_assigned_subject,
        DROP COLUMN assigned_classroom_subject_id,
        ADD CONSTRAINT fk_classroom_attendance_links_assigned_classroom
          FOREIGN KEY (assigned_classroom_id, school_id)
          REFERENCES school_classrooms(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT chk_classroom_attendance_links_kind CHECK (
          (teacher_membership_id IS NOT NULL AND assigned_classroom_id IS NULL
           AND expires_at IS NULL AND opens_at IS NULL)
          OR
          (teacher_membership_id IS NULL AND assigned_classroom_id IS NOT NULL
           AND expires_at IS NOT NULL)
        )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_classroom_attendance_links_assignment
        ON classroom_attendance_links (assigned_classroom_id, school_id, expires_at DESC)
        WHERE assigned_classroom_id IS NOT NULL;
    `);
  }
}
