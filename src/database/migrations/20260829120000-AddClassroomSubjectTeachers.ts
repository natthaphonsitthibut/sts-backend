import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * Who teaches a subject in a classroom.
 *
 * `classroom_subjects` says a subject is offered to a classroom but never said
 * by whom, so nothing in the system could answer "which classrooms are mine".
 * A join table rather than a column because a subject is co-taught: the retired
 * `curriculum_subject_teachers` modelled the same many-to-many, and this keeps
 * that shape while hanging off the offering table that is actually in use.
 *
 * Both foreign keys carry `school_id` so the database itself refuses a teacher
 * from one school being assigned to another's classroom — a check that cannot
 * be forgotten in a service the way a WHERE clause can.
 *
 * Structure only: no row assigns a teacher to anything. Who teaches what is a
 * decision each school makes through the curriculum screen, and a migration
 * guessing it would silently create real assignments in production.
 */
export class AddClassroomSubjectTeachers20260829120000 implements MigrationInterface {
  name = 'AddClassroomSubjectTeachers20260829120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE classroom_subject_teachers (
        id BIGSERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL,
        classroom_id BIGINT NOT NULL,
        classroom_subject_id BIGINT NOT NULL,
        teacher_membership_id BIGINT NOT NULL,
        assignment_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT fk_classroom_subject_teachers_offering
          FOREIGN KEY (classroom_subject_id, classroom_id, school_id)
          REFERENCES classroom_subjects(id, classroom_id, school_id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_classroom_subject_teachers_membership
          FOREIGN KEY (teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_classroom_subject_teachers_status
          CHECK (assignment_status IN ('ACTIVE', 'INACTIVE'))
      );
      ${auditUpdatedAtTriggerSql('classroom_subject_teachers')}

      CREATE UNIQUE INDEX uq_classroom_subject_teachers_live
        ON classroom_subject_teachers (classroom_subject_id, teacher_membership_id)
        WHERE deleted_at IS NULL;

      -- "ห้องเรียนของฉัน" and the check-in subject list both start from the
      -- teacher, so that is the leading column rather than the offering.
      CREATE INDEX idx_classroom_subject_teachers_teacher
        ON classroom_subject_teachers (teacher_membership_id, school_id, assignment_status)
        WHERE deleted_at IS NULL;

      CREATE INDEX idx_classroom_subject_teachers_classroom
        ON classroom_subject_teachers (classroom_id, school_id)
        WHERE deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE classroom_subject_teachers`);
  }
}
