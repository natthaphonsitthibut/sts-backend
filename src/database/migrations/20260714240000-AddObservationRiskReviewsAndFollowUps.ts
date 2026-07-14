import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditUpdatedAtTriggerSql } from '../bootstrap-sql';

export class AddObservationRiskReviewsAndFollowUps20260714240000 implements MigrationInterface {
  name = 'AddObservationRiskReviewsAndFollowUps20260714240000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE student_observation_risk_reviews (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_uuid UUID NOT NULL,
        school_id INTEGER NOT NULL,
        calculated_attendance_risk VARCHAR(16) NOT NULL,
        teacher_concern_signal VARCHAR(16) NOT NULL,
        human_risk_decision VARCHAR(24) NOT NULL,
        decision_reason VARCHAR(1000) NOT NULL,
        decided_by INTEGER NOT NULL,
        decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        revision_number INTEGER NOT NULL,
        CONSTRAINT uq_observation_risk_reviews_revision
          UNIQUE (student_uuid, revision_number),
        CONSTRAINT fk_observation_risk_reviews_enrollment_school
          FOREIGN KEY (student_uuid, school_id)
          REFERENCES student_term(student_uuid, "SchoolID_Onec")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_observation_risk_reviews_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_observation_risk_reviews_actor
          FOREIGN KEY (decided_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_observation_risk_reviews_calculated_risk
          CHECK (calculated_attendance_risk IN ('UNKNOWN', 'NORMAL', 'WATCH', 'LOW', 'MEDIUM', 'HIGH')),
        CONSTRAINT chk_observation_risk_reviews_teacher_signal
          CHECK (teacher_concern_signal IN ('NONE', 'WATCH', 'CONCERN')),
        CONSTRAINT chk_observation_risk_reviews_decision
          CHECK (human_risk_decision IN ('CONFIRM_RISK', 'WATCH', 'NO_ACTION')),
        CONSTRAINT chk_observation_risk_reviews_reason
          CHECK (length(trim(decision_reason)) BETWEEN 1 AND 1000),
        CONSTRAINT chk_observation_risk_reviews_revision
          CHECK (revision_number > 0)
      );
      CREATE INDEX idx_observation_risk_reviews_student_latest
        ON student_observation_risk_reviews (student_uuid, revision_number DESC);
      CREATE INDEX idx_observation_risk_reviews_school_time
        ON student_observation_risk_reviews (school_id, decided_at DESC);

      CREATE TABLE student_observation_risk_review_sources (
        risk_review_id UUID NOT NULL,
        observation_id BIGINT NOT NULL,
        observation_revision INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_observation_risk_review_sources
          PRIMARY KEY (risk_review_id, observation_id),
        CONSTRAINT fk_observation_risk_review_sources_review
          FOREIGN KEY (risk_review_id) REFERENCES student_observation_risk_reviews(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_observation_risk_review_sources_observation_revision
          FOREIGN KEY (observation_id, observation_revision)
          REFERENCES student_observation_revisions(observation_id, revision_number)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_observation_risk_review_sources_revision
          CHECK (observation_revision > 0)
      );
      CREATE INDEX idx_observation_risk_review_sources_observation
        ON student_observation_risk_review_sources (observation_id, observation_revision);

      CREATE TABLE student_follow_up_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        student_uuid UUID NOT NULL,
        school_id INTEGER NOT NULL,
        follow_up_request_type VARCHAR(32) NOT NULL DEFAULT 'HOME_VISIT_CONSIDERATION',
        status VARCHAR(24) NOT NULL DEFAULT 'PENDING_REVIEW',
        urgency VARCHAR(16) NOT NULL,
        request_reason VARCHAR(1000) NOT NULL,
        supplemental_note VARCHAR(2000),
        requested_by INTEGER NOT NULL,
        requester_teacher_membership_id BIGINT NOT NULL,
        source_teacher_access_grant_id UUID,
        source_assignment_id BIGINT NOT NULL,
        review_decision VARCHAR(24),
        review_reason VARCHAR(1000),
        reviewed_by INTEGER,
        reviewed_at TIMESTAMPTZ,
        revision_number INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_follow_up_requests_enrollment_school
          FOREIGN KEY (student_uuid, school_id)
          REFERENCES student_term(student_uuid, "SchoolID_Onec")
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_follow_up_requests_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_follow_up_requests_requester
          FOREIGN KEY (requested_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_follow_up_requests_membership
          FOREIGN KEY (requester_teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_follow_up_requests_teacher_grant
          FOREIGN KEY (source_teacher_access_grant_id) REFERENCES teacher_access_grants(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_follow_up_requests_assignment
          FOREIGN KEY (source_assignment_id) REFERENCES classroom_teacher_assignments(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_follow_up_requests_reviewer
          FOREIGN KEY (reviewed_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_follow_up_requests_type
          CHECK (follow_up_request_type IN ('HOME_VISIT_CONSIDERATION')),
        CONSTRAINT chk_follow_up_requests_status
          CHECK (status IN ('PENDING_REVIEW', 'APPROVE_AND_ASSIGN', 'NEED_MORE_INFO', 'REJECT')),
        CONSTRAINT chk_follow_up_requests_urgency
          CHECK (urgency IN ('NORMAL', 'URGENT')),
        CONSTRAINT chk_follow_up_requests_reason
          CHECK (length(trim(request_reason)) BETWEEN 1 AND 1000),
        CONSTRAINT chk_follow_up_requests_note
          CHECK (supplemental_note IS NULL OR length(trim(supplemental_note)) BETWEEN 1 AND 2000),
        CONSTRAINT chk_follow_up_requests_review_state
          CHECK (
            (status = 'PENDING_REVIEW' AND review_decision IS NULL AND review_reason IS NULL
              AND reviewed_by IS NULL AND reviewed_at IS NULL)
            OR
            (status <> 'PENDING_REVIEW' AND review_decision = status
              AND review_reason IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
          ),
        CONSTRAINT chk_follow_up_requests_review_reason
          CHECK (review_reason IS NULL OR length(trim(review_reason)) BETWEEN 1 AND 1000),
        CONSTRAINT chk_follow_up_requests_revision CHECK (revision_number > 0)
      );
      ${auditUpdatedAtTriggerSql('student_follow_up_requests')}
      CREATE UNIQUE INDEX uq_follow_up_requests_pending_type
        ON student_follow_up_requests (student_uuid, follow_up_request_type)
        WHERE status = 'PENDING_REVIEW';
      CREATE INDEX idx_follow_up_requests_school_queue
        ON student_follow_up_requests (school_id, status, urgency, created_at DESC);
      CREATE INDEX idx_follow_up_requests_student_history
        ON student_follow_up_requests (student_uuid, created_at DESC);

      CREATE TABLE student_follow_up_request_sources (
        follow_up_request_id UUID NOT NULL,
        observation_id BIGINT NOT NULL,
        observation_revision INTEGER NOT NULL,
        added_by INTEGER NOT NULL,
        source_teacher_access_grant_id UUID,
        added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_follow_up_request_sources
          PRIMARY KEY (follow_up_request_id, observation_id),
        CONSTRAINT fk_follow_up_request_sources_request
          FOREIGN KEY (follow_up_request_id) REFERENCES student_follow_up_requests(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_follow_up_request_sources_observation_revision
          FOREIGN KEY (observation_id, observation_revision)
          REFERENCES student_observation_revisions(observation_id, revision_number)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_follow_up_request_sources_actor
          FOREIGN KEY (added_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_follow_up_request_sources_teacher_grant
          FOREIGN KEY (source_teacher_access_grant_id) REFERENCES teacher_access_grants(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_follow_up_request_sources_revision
          CHECK (observation_revision > 0)
      );
      CREATE INDEX idx_follow_up_request_sources_observation
        ON student_follow_up_request_sources (observation_id, observation_revision);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE IF EXISTS student_follow_up_request_sources;
      DROP TABLE IF EXISTS student_follow_up_requests;
      DROP TABLE IF EXISTS student_observation_risk_review_sources;
      DROP TABLE IF EXISTS student_observation_risk_reviews;
    `);
  }
}
