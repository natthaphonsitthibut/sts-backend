import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SeparateCaseRiskSignals20260724120000 implements MigrationInterface {
  name = 'SeparateCaseRiskSignals20260724120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE case_risk_signals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        case_id INTEGER NOT NULL,
        signal_source_code VARCHAR(40) NOT NULL,
        signal_rule_code VARCHAR(40),
        signal_reason VARCHAR(1000) NOT NULL,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_case_risk_signals_case
          FOREIGN KEY (case_id) REFERENCES cases(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT uq_case_risk_signals_reason
          UNIQUE (case_id, signal_source_code, signal_reason),
        CONSTRAINT chk_case_risk_signals_source
          CHECK (signal_source_code IN ('SUBJECT_RISK_MONITOR')),
        CONSTRAINT chk_case_risk_signals_rule
          CHECK (
            signal_rule_code IS NULL
            OR signal_rule_code IN (
              'MIXED_SUBJECT_ABSENCE',
              'SUBJECT_AVOIDANCE_STREAK',
              'SUBJECT_AVOIDANCE_PERCENT',
              'TERM_ABSENCE_ACCUMULATION',
              'LOW_ATTENDANCE_PERCENT'
            )
          ),
        CONSTRAINT chk_case_risk_signals_reason
          CHECK (length(trim(signal_reason)) BETWEEN 1 AND 1000)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_case_risk_signals_case_detected
      ON case_risk_signals (case_id, detected_at DESC)
    `);
    await queryRunner.query(`
      DO $case_risk_signal_duplicate_check$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM case_reviews review
          WHERE review.reviewed_by = 'system:subject-risk-monitor'
            AND review.source_actor_user_id IS NULL
            AND review.review_action = 'CONTINUE'
            AND review.review_note IS NOT NULL
          GROUP BY review.case_id, review.review_note
          HAVING COUNT(*) > 1
        ) THEN
          RAISE EXCEPTION 'duplicate subject-risk review rows must be reconciled before migration';
        END IF;
      END
      $case_risk_signal_duplicate_check$
    `);
    await queryRunner.query(`
      INSERT INTO case_risk_signals (
        id,
        case_id,
        signal_source_code,
        signal_rule_code,
        signal_reason,
        detected_at,
        created_at
      )
      SELECT
        review.id,
        review.case_id,
        'SUBJECT_RISK_MONITOR',
        CASE
          WHEN review.review_note LIKE 'โดดคาบ:%' THEN 'MIXED_SUBJECT_ABSENCE'
          WHEN review.review_note LIKE 'เลี่ยงวิชาเดิม:%คาบติดกัน' THEN 'SUBJECT_AVOIDANCE_STREAK'
          WHEN review.review_note LIKE 'เลี่ยงวิชาเดิม:%ของคาบในช่วงที่กำหนด' THEN 'SUBJECT_AVOIDANCE_PERCENT'
          WHEN review.review_note LIKE 'ขาดสะสมต่อเทอม%' THEN 'TERM_ABSENCE_ACCUMULATION'
          WHEN review.review_note LIKE 'เวลาเรียนต่ำกว่าเกณฑ์:%' THEN 'LOW_ATTENDANCE_PERCENT'
          ELSE NULL
        END,
        review.review_note,
        COALESCE(review.reviewed_at, review.created_at),
        review.created_at
      FROM case_reviews review
      WHERE review.reviewed_by = 'system:subject-risk-monitor'
        AND review.source_actor_user_id IS NULL
        AND review.review_action = 'CONTINUE'
        AND review.review_note IS NOT NULL
    `);
    await queryRunner.query(`
      DO $case_risk_signal_reconcile$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM case_reviews review
          LEFT JOIN case_risk_signals signal
            ON signal.id = review.id
           AND signal.case_id = review.case_id
           AND signal.signal_source_code = 'SUBJECT_RISK_MONITOR'
           AND signal.signal_reason = review.review_note
          WHERE review.reviewed_by = 'system:subject-risk-monitor'
            AND review.source_actor_user_id IS NULL
            AND review.review_action = 'CONTINUE'
            AND review.review_note IS NOT NULL
            AND signal.id IS NULL
        ) THEN
          RAISE EXCEPTION 'subject-risk review migration reconciliation failed';
        END IF;
      END
      $case_risk_signal_reconcile$
    `);
    await queryRunner.query(`
      DELETE FROM case_reviews
      WHERE reviewed_by = 'system:subject-risk-monitor'
        AND source_actor_user_id IS NULL
        AND review_action = 'CONTINUE'
        AND review_note IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $case_risk_signal_rollback_collision_check$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM case_risk_signals signal
          JOIN case_reviews review ON review.id = signal.id
          WHERE signal.signal_source_code = 'SUBJECT_RISK_MONITOR'
        ) THEN
          RAISE EXCEPTION 'case review id collision prevents risk signal rollback';
        END IF;
      END
      $case_risk_signal_rollback_collision_check$
    `);
    await queryRunner.query(`
      INSERT INTO case_reviews (
        id,
        case_id,
        review_action,
        review_note,
        reviewed_by,
        reviewed_at
      )
      SELECT
        signal.id,
        signal.case_id,
        'CONTINUE',
        signal.signal_reason,
        'system:subject-risk-monitor',
        signal.detected_at
      FROM case_risk_signals signal
      WHERE signal.signal_source_code = 'SUBJECT_RISK_MONITOR'
    `);
    await queryRunner.query(`
      DO $case_risk_signal_rollback_reconcile$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM case_risk_signals signal
          LEFT JOIN case_reviews review
            ON review.id = signal.id
           AND review.case_id = signal.case_id
           AND review.reviewed_by = 'system:subject-risk-monitor'
           AND review.review_note = signal.signal_reason
          WHERE signal.signal_source_code = 'SUBJECT_RISK_MONITOR'
            AND review.id IS NULL
        ) THEN
          RAISE EXCEPTION 'risk signal rollback reconciliation failed';
        END IF;
      END
      $case_risk_signal_rollback_reconcile$
    `);
    await queryRunner.query(`DROP INDEX idx_case_risk_signals_case_detected`);
    await queryRunner.query(`DROP TABLE case_risk_signals`);
  }
}
