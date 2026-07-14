import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStudentObservationSummaries20260714270000 implements MigrationInterface {
  name = 'AddStudentObservationSummaries20260714270000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE student_observation_summaries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_uuid UUID NOT NULL,
        school_id INTEGER NOT NULL,
        requested_by_user_id INTEGER NOT NULL,
        input_fingerprint CHAR(64) NOT NULL,
        provider_code VARCHAR(64) NOT NULL,
        model_code VARCHAR(128) NOT NULL,
        prompt_version VARCHAR(64) NOT NULL,
        summary_text TEXT NOT NULL,
        themes JSONB NOT NULL DEFAULT '[]'::jsonb,
        trends JSONB NOT NULL DEFAULT '[]'::jsonb,
        agreements JSONB NOT NULL DEFAULT '[]'::jsonb,
        conflicting_evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
        source_observation_count INTEGER NOT NULL,
        is_stale BOOLEAN NOT NULL DEFAULT FALSE,
        review_state VARCHAR(24) NOT NULL DEFAULT 'PENDING_REVIEW',
        reviewed_by_user_id INTEGER,
        reviewer_display_name VARCHAR(200),
        review_note VARCHAR(1000),
        reviewed_at TIMESTAMPTZ,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_observation_summaries_enrollment_school
          FOREIGN KEY (student_uuid, school_id)
          REFERENCES student_term(student_uuid, "SchoolID_Onec")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_observation_summaries_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_observation_summaries_requester
          FOREIGN KEY (requested_by_user_id) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_observation_summaries_reviewer
          FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT uq_observation_summaries_input
          UNIQUE (student_uuid, input_fingerprint, provider_code, model_code, prompt_version),
        CONSTRAINT chk_observation_summaries_fingerprint
          CHECK (input_fingerprint ~ '^[0-9a-f]{64}$'),
        CONSTRAINT chk_observation_summaries_versions
          CHECK (
            length(trim(provider_code)) BETWEEN 1 AND 64
            AND length(trim(model_code)) BETWEEN 1 AND 128
            AND length(trim(prompt_version)) BETWEEN 1 AND 64
          ),
        CONSTRAINT chk_observation_summaries_text
          CHECK (length(trim(summary_text)) BETWEEN 1 AND 10000),
        CONSTRAINT chk_observation_summaries_arrays
          CHECK (
            jsonb_typeof(themes) = 'array'
            AND jsonb_typeof(trends) = 'array'
            AND jsonb_typeof(agreements) = 'array'
            AND jsonb_typeof(conflicting_evidence) = 'array'
          ),
        CONSTRAINT chk_observation_summaries_source_count
          CHECK (source_observation_count BETWEEN 1 AND 100),
        CONSTRAINT chk_observation_summaries_review_state
          CHECK (review_state IN ('PENDING_REVIEW', 'REVIEWED', 'REJECTED')),
        CONSTRAINT chk_observation_summaries_review_metadata
          CHECK (
            (review_state = 'PENDING_REVIEW'
              AND reviewed_by_user_id IS NULL
              AND reviewer_display_name IS NULL
              AND review_note IS NULL
              AND reviewed_at IS NULL)
            OR
            (review_state IN ('REVIEWED', 'REJECTED')
              AND reviewer_display_name IS NOT NULL
              AND length(trim(reviewer_display_name)) > 0
              AND reviewed_at IS NOT NULL)
          ),
        CONSTRAINT chk_observation_summaries_review_note
          CHECK (
            review_note IS NULL OR length(trim(review_note)) BETWEEN 1 AND 1000
          ),
        CONSTRAINT chk_observation_summaries_rejection_note
          CHECK (review_state <> 'REJECTED' OR review_note IS NOT NULL)
      );
      CREATE INDEX idx_observation_summaries_student_timeline
        ON student_observation_summaries (student_uuid, generated_at DESC, id DESC);
      CREATE INDEX idx_observation_summaries_school_review
        ON student_observation_summaries (school_id, review_state, generated_at DESC)
        WHERE is_stale = FALSE;

      CREATE TABLE student_observation_summary_sources (
        summary_id UUID NOT NULL,
        observation_id BIGINT NOT NULL,
        observation_revision INTEGER NOT NULL,
        citation_order SMALLINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_observation_summary_sources
          PRIMARY KEY (summary_id, observation_id, observation_revision),
        CONSTRAINT uq_observation_summary_sources_order
          UNIQUE (summary_id, citation_order),
        CONSTRAINT fk_observation_summary_sources_summary
          FOREIGN KEY (summary_id) REFERENCES student_observation_summaries(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_observation_summary_sources_revision
          FOREIGN KEY (observation_id, observation_revision)
          REFERENCES student_observation_revisions(observation_id, revision_number)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_observation_summary_sources_revision
          CHECK (observation_revision > 0),
        CONSTRAINT chk_observation_summary_sources_order
          CHECK (citation_order >= 0)
      );
      CREATE INDEX idx_observation_summary_sources_observation
        ON student_observation_summary_sources (observation_id, observation_revision);

      CREATE FUNCTION mark_student_observation_summaries_stale()
      RETURNS TRIGGER AS $stale$
      BEGIN
        UPDATE student_observation_summaries summary
        SET is_stale = TRUE, updated_at = now()
        FROM student_observations observation
        WHERE observation.id = NEW.observation_id
          AND summary.student_uuid = observation.student_uuid
          AND summary.is_stale = FALSE;
        RETURN NEW;
      END;
      $stale$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_student_observation_summary_stale
      AFTER INSERT ON student_observation_revisions
      FOR EACH ROW EXECUTE FUNCTION mark_student_observation_summaries_stale();
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_student_observation_summary_stale
        ON student_observation_revisions;
      DROP FUNCTION IF EXISTS mark_student_observation_summaries_stale();
      DROP TABLE IF EXISTS student_observation_summary_sources;
      DROP TABLE IF EXISTS student_observation_summaries;
    `);
  }
}
