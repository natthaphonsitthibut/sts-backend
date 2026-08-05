import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const CURRICULUM_PERMISSION = 'manage-curriculum';
const CURRICULUM_PERMISSION_ROLES = ['ADMIN', 'DIRECTOR'] as const;

/**
 * จัดการข้อมูลหลักสูตร — the subjects a school offers for one grade level in one
 * term, and which teacher covers which classroom for each of them.
 *
 * `subjects` stays the shared catalogue (code + Thai name). What is new is the
 * *offering*: this school, this term, this grade level teaches that subject —
 * plus the learning-content PDF that belongs to the offering rather than to the
 * catalogue entry.
 *
 * Teacher coverage is its own table instead of reusing
 * `classroom_teacher_assignments`, which models timetable/homeroom duty and is
 * already consumed by teacher access grants. Keeping curriculum coverage
 * separate means one subject can carry many teachers, each over many classrooms,
 * without overloading the meaning of an existing row.
 *
 * Every FK is composite on `school_id`, so a curriculum row can never reference
 * a classroom, term or teacher that belongs to another school.
 */
export class AddCurriculumSubjects20260803120000 implements MigrationInterface {
  name = 'AddCurriculumSubjects20260803120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE school_classrooms
        ADD CONSTRAINT uq_school_classrooms_id_school_term_grade
        UNIQUE (id, school_id, school_term_id, grade_level_id);

      CREATE TABLE curriculum_subjects (
        id BIGSERIAL PRIMARY KEY,
        school_id INTEGER NOT NULL,
        school_term_id BIGINT NOT NULL,
        grade_level_id INTEGER NOT NULL,
        subject_id INTEGER NOT NULL,
        content_storage_key VARCHAR(255),
        content_file_name VARCHAR(255),
        content_file_size_bytes INTEGER,
        curriculum_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT uq_curriculum_subjects_id_school_term_grade
          UNIQUE (id, school_id, school_term_id, grade_level_id),
        CONSTRAINT fk_curriculum_subjects_term_school
          FOREIGN KEY (school_term_id, school_id)
          REFERENCES school_terms(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_curriculum_subjects_grade
          FOREIGN KEY (grade_level_id) REFERENCES grade_levels(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_curriculum_subjects_subject
          FOREIGN KEY (subject_id) REFERENCES subjects(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_curriculum_subjects_status
          CHECK (curriculum_status IN ('ACTIVE', 'INACTIVE')),
        -- Either the whole file descriptor is present or none of it is.
        CONSTRAINT chk_curriculum_subjects_content
          CHECK (
            (content_storage_key IS NULL AND content_file_name IS NULL
              AND content_file_size_bytes IS NULL)
            OR (content_storage_key IS NOT NULL AND content_file_name IS NOT NULL
              AND content_file_size_bytes IS NOT NULL AND content_file_size_bytes > 0)
          )
      );
      ${auditUpdatedAtTriggerSql('curriculum_subjects')}

      CREATE UNIQUE INDEX uq_curriculum_subjects_offering
        ON curriculum_subjects (school_term_id, grade_level_id, subject_id)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_curriculum_subjects_scope
        ON curriculum_subjects (school_id, school_term_id, grade_level_id)
        WHERE deleted_at IS NULL;

      CREATE TABLE curriculum_subject_teachers (
        id BIGSERIAL PRIMARY KEY,
        curriculum_subject_id BIGINT NOT NULL,
        school_id INTEGER NOT NULL,
        school_term_id BIGINT NOT NULL,
        grade_level_id INTEGER NOT NULL,
        teacher_membership_id BIGINT NOT NULL,
        classroom_id BIGINT NOT NULL,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT fk_curriculum_subject_teachers_offering
          FOREIGN KEY (curriculum_subject_id, school_id, school_term_id, grade_level_id)
          REFERENCES curriculum_subjects(id, school_id, school_term_id, grade_level_id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_curriculum_subject_teachers_membership
          FOREIGN KEY (teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        -- Binds the classroom to the same term and grade as the offering, so a
        -- ม.1 subject can never be attached to a ม.2 room.
        CONSTRAINT fk_curriculum_subject_teachers_classroom
          FOREIGN KEY (classroom_id, school_id, school_term_id, grade_level_id)
          REFERENCES school_classrooms(id, school_id, school_term_id, grade_level_id)
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
      ${auditUpdatedAtTriggerSql('curriculum_subject_teachers')}

      CREATE UNIQUE INDEX uq_curriculum_subject_teachers_coverage
        ON curriculum_subject_teachers
          (curriculum_subject_id, teacher_membership_id, classroom_id)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_curriculum_subject_teachers_subject
        ON curriculum_subject_teachers (curriculum_subject_id)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_curriculum_subject_teachers_teacher
        ON curriculum_subject_teachers (teacher_membership_id)
        WHERE deleted_at IS NULL;
      CREATE INDEX idx_curriculum_subject_teachers_classroom
        ON curriculum_subject_teachers (classroom_id)
        WHERE deleted_at IS NULL;
    `);

    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions || $1::jsonb
        WHERE name = ANY($2::text[])
          AND NOT (default_permissions ? $3)
      `,
      [JSON.stringify([CURRICULUM_PERMISSION]), CURRICULUM_PERMISSION_ROLES, CURRICULUM_PERMISSION],
    );
    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions || $1::jsonb
        WHERE jsonb_typeof(permissions) = 'array'
          AND permissions ? 'manage-school-structure'
          AND NOT (permissions ? $2)
      `,
      [JSON.stringify([CURRICULUM_PERMISSION]), CURRICULUM_PERMISSION],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE users SET permissions = permissions - $1`, [
      CURRICULUM_PERMISSION,
    ]);
    await queryRunner.query(`UPDATE roles SET default_permissions = default_permissions - $1`, [
      CURRICULUM_PERMISSION,
    ]);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_curriculum_subject_teachers_set_updated_at
        ON curriculum_subject_teachers;
      DROP TABLE IF EXISTS curriculum_subject_teachers;

      DROP TRIGGER IF EXISTS trg_curriculum_subjects_set_updated_at ON curriculum_subjects;
      DROP TABLE IF EXISTS curriculum_subjects;

      ALTER TABLE school_classrooms
        DROP CONSTRAINT IF EXISTS uq_school_classrooms_id_school_term_grade;
    `);
  }
}
