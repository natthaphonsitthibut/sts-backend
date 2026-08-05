import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

const READ_PERMISSION = 'student-observations';
const MANAGE_PERMISSION = 'manage-student-observations';

export class AddStudentObservations20260714230000 implements MigrationInterface {
  name = 'AddStudentObservations20260714230000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_term
        ADD CONSTRAINT uq_student_term_uuid_school
        UNIQUE (student_uuid, "SchoolID_Onec");

      CREATE TABLE observation_dimensions (
        id BIGSERIAL PRIMARY KEY,
        code VARCHAR(32) NOT NULL UNIQUE,
        label_th VARCHAR(100) NOT NULL,
        requires_comment BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order SMALLINT NOT NULL,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_observation_dimensions_code
          CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
        CONSTRAINT chk_observation_dimensions_label
          CHECK (length(trim(label_th)) > 0),
        CONSTRAINT chk_observation_dimensions_sort_order CHECK (sort_order >= 0)
      );
      ${auditUpdatedAtTriggerSql('observation_dimensions')}

      INSERT INTO observation_dimensions (code, label_th, requires_comment, sort_order)
      VALUES
        ('ATTENDANCE', 'การเข้าเรียน', FALSE, 10),
        ('LEARNING', 'การเรียน', FALSE, 20),
        ('BEHAVIOR', 'พฤติกรรม', FALSE, 30),
        ('EMOTIONAL', 'อารมณ์', FALSE, 40),
        ('SOCIAL', 'สังคม', FALSE, 50),
        ('FAMILY', 'ครอบครัว', FALSE, 60),
        ('OTHER', 'อื่น ๆ', TRUE, 70);

      CREATE TABLE observation_behavior_tags (
        id BIGSERIAL PRIMARY KEY,
        code VARCHAR(48) NOT NULL UNIQUE,
        label_th VARCHAR(120) NOT NULL,
        observation_dimension_id BIGINT,
        requires_comment BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order SMALLINT NOT NULL,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT fk_observation_behavior_tags_dimension
          FOREIGN KEY (observation_dimension_id) REFERENCES observation_dimensions(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_observation_behavior_tags_code
          CHECK (code ~ '^[A-Z][A-Z0-9_]{1,47}$'),
        CONSTRAINT chk_observation_behavior_tags_label
          CHECK (length(trim(label_th)) > 0),
        CONSTRAINT chk_observation_behavior_tags_sort_order CHECK (sort_order >= 0)
      );
      ${auditUpdatedAtTriggerSql('observation_behavior_tags')}

      INSERT INTO observation_behavior_tags (
        code, label_th, observation_dimension_id, requires_comment, sort_order
      )
      SELECT seed.code, seed.label_th, dimension.id, seed.requires_comment, seed.sort_order
      FROM (
        VALUES
          ('MISSING_ASSIGNMENTS', 'ไม่ส่งงาน', 'LEARNING', FALSE, 10),
          ('SLEEPING_IN_CLASS', 'หลับในห้อง', 'LEARNING', FALSE, 20),
          ('DISTRACTED', 'ไม่มีสมาธิ', 'BEHAVIOR', FALSE, 30),
          ('SOCIAL_WITHDRAWAL', 'แยกตัว', 'SOCIAL', FALSE, 40),
          ('PEER_CONFLICT', 'ทะเลาะกับเพื่อน', 'SOCIAL', FALSE, 50),
          ('MISSING_EQUIPMENT', 'อุปกรณ์ไม่พร้อม', 'LEARNING', FALSE, 60),
          ('OTHER', 'อื่น ๆ', NULL, TRUE, 70)
      ) AS seed(code, label_th, dimension_code, requires_comment, sort_order)
      LEFT JOIN observation_dimensions dimension ON dimension.code = seed.dimension_code;

      CREATE TABLE student_observations (
        id BIGSERIAL PRIMARY KEY,
        student_uuid UUID NOT NULL,
        school_id INTEGER NOT NULL,
        author_kind VARCHAR(24) NOT NULL,
        author_user_id INTEGER NOT NULL,
        author_teacher_membership_id BIGINT,
        source_teacher_access_grant_id UUID,
        source_assignment_id BIGINT,
        observation_dimension_id BIGINT NOT NULL,
        concern_level VARCHAR(16) NOT NULL DEFAULT 'NOTE',
        comment TEXT,
        comment_required BOOLEAN NOT NULL DEFAULT FALSE,
        observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        revision_number INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_student_observations_enrollment_school
          FOREIGN KEY (student_uuid, school_id)
          REFERENCES student_term(student_uuid, "SchoolID_Onec")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_observations_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_observations_author
          FOREIGN KEY (author_user_id) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_observations_author_membership
          FOREIGN KEY (author_teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_observations_teacher_grant
          FOREIGN KEY (source_teacher_access_grant_id)
          REFERENCES teacher_access_grants(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_observations_assignment
          FOREIGN KEY (source_assignment_id)
          REFERENCES classroom_teacher_assignments(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_observations_dimension
          FOREIGN KEY (observation_dimension_id) REFERENCES observation_dimensions(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_student_observations_author_kind
          CHECK (author_kind IN ('USER', 'TEACHER_ACCESS')),
        CONSTRAINT chk_student_observations_author_context
          CHECK (
            (author_kind = 'USER' AND source_teacher_access_grant_id IS NULL)
            OR (
              author_kind = 'TEACHER_ACCESS'
              AND source_teacher_access_grant_id IS NOT NULL
              AND author_teacher_membership_id IS NOT NULL
              AND source_assignment_id IS NOT NULL
            )
          ),
        CONSTRAINT chk_student_observations_concern_level
          CHECK (concern_level IN ('NOTE', 'WATCH', 'CONCERN')),
        CONSTRAINT chk_student_observations_comment_length
          CHECK (comment IS NULL OR length(trim(comment)) BETWEEN 1 AND 2000),
        CONSTRAINT chk_student_observations_required_comment
          CHECK (
            (concern_level <> 'CONCERN' AND comment_required = FALSE)
            OR (comment IS NOT NULL AND length(trim(comment)) > 0)
          ),
        CONSTRAINT chk_student_observations_revision CHECK (revision_number > 0)
      );
      CREATE INDEX idx_student_observations_student_timeline
        ON student_observations (student_uuid, observed_at DESC, id DESC);
      CREATE INDEX idx_student_observations_school_concern
        ON student_observations (school_id, concern_level, observed_at DESC);
      CREATE INDEX idx_student_observations_assignment
        ON student_observations (source_assignment_id, observed_at DESC)
        WHERE source_assignment_id IS NOT NULL;

      CREATE TABLE student_observation_tags (
        observation_id BIGINT NOT NULL,
        behavior_tag_id BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_student_observation_tags PRIMARY KEY (observation_id, behavior_tag_id),
        CONSTRAINT fk_student_observation_tags_observation
          FOREIGN KEY (observation_id) REFERENCES student_observations(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_student_observation_tags_tag
          FOREIGN KEY (behavior_tag_id) REFERENCES observation_behavior_tags(id)
          ON DELETE RESTRICT ON UPDATE CASCADE
      );
      CREATE INDEX idx_student_observation_tags_tag
        ON student_observation_tags (behavior_tag_id, observation_id);

      CREATE TABLE student_observation_revisions (
        id BIGSERIAL PRIMARY KEY,
        observation_id BIGINT NOT NULL,
        revision_number INTEGER NOT NULL,
        observation_dimension_id BIGINT NOT NULL,
        concern_level VARCHAR(16) NOT NULL,
        comment TEXT,
        comment_required BOOLEAN NOT NULL,
        observed_at TIMESTAMPTZ NOT NULL,
        behavior_tag_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
        changed_by_user_id INTEGER NOT NULL,
        source_teacher_access_grant_id UUID,
        change_reason VARCHAR(500),
        changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_student_observation_revisions_number
          UNIQUE (observation_id, revision_number),
        CONSTRAINT fk_student_observation_revisions_observation
          FOREIGN KEY (observation_id) REFERENCES student_observations(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_observation_revisions_dimension
          FOREIGN KEY (observation_dimension_id) REFERENCES observation_dimensions(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_observation_revisions_actor
          FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_observation_revisions_grant
          FOREIGN KEY (source_teacher_access_grant_id) REFERENCES teacher_access_grants(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_student_observation_revisions_number CHECK (revision_number > 0),
        CONSTRAINT chk_student_observation_revisions_concern
          CHECK (concern_level IN ('NOTE', 'WATCH', 'CONCERN')),
        CONSTRAINT chk_student_observation_revisions_comment
          CHECK (comment IS NULL OR length(trim(comment)) BETWEEN 1 AND 2000),
        CONSTRAINT chk_student_observation_revisions_required_comment
          CHECK (
            (concern_level <> 'CONCERN' AND comment_required = FALSE)
            OR (comment IS NOT NULL AND length(trim(comment)) > 0)
          ),
        CONSTRAINT chk_student_observation_revisions_tag_ids
          CHECK (jsonb_typeof(behavior_tag_ids) = 'array'),
        CONSTRAINT chk_student_observation_revisions_reason
          CHECK (change_reason IS NULL OR length(trim(change_reason)) BETWEEN 1 AND 500)
      );
      CREATE INDEX idx_student_observation_revisions_history
        ON student_observation_revisions (observation_id, revision_number DESC);
    `);

    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions || $1::jsonb
        WHERE name = ANY($2::text[])
          AND NOT (default_permissions ? $3)
      `,
      [JSON.stringify([MANAGE_PERMISSION]), ['ADMIN', 'DIRECTOR'], MANAGE_PERMISSION],
    );
    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions || $1::jsonb
        WHERE name = 'TEACHER'
          AND NOT (default_permissions ? $2)
      `,
      [JSON.stringify([READ_PERMISSION]), READ_PERMISSION],
    );
    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions || $1::jsonb
        WHERE jsonb_typeof(permissions) = 'array'
          AND permissions ? 'manage-school-structure'
          AND NOT (permissions ? $2)
      `,
      [JSON.stringify([MANAGE_PERMISSION]), MANAGE_PERMISSION],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE users SET permissions = permissions - '${MANAGE_PERMISSION}'`);
    await queryRunner.query(
      `UPDATE roles SET default_permissions = default_permissions - '${MANAGE_PERMISSION}' - '${READ_PERMISSION}'`,
    );
    await queryRunner.query(`
      DROP TABLE IF EXISTS student_observation_revisions;
      DROP TABLE IF EXISTS student_observation_tags;
      DROP TABLE IF EXISTS student_observations;
      DROP TABLE IF EXISTS observation_behavior_tags;
      DROP TABLE IF EXISTS observation_dimensions;
      ALTER TABLE student_term DROP CONSTRAINT IF EXISTS uq_student_term_uuid_school;
    `);
  }
}
