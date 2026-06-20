import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase A (A5 + A6) — finish timestamp tz-consistency and widen GPS precision.
 *
 * A5: three domain timestamps were still `timestamp WITHOUT time zone` while
 *   every audit/created_at column is `timestamptz` — a wall-clock ambiguity of
 *   the same class as the P1-6 timezone bug. The dev/prod Postgres runs in UTC,
 *   so the naive values are UTC; `AT TIME ZONE 'UTC'` reinterprets them as such
 *   (same convention as the Phase 2a audit retrofit). Columns covered:
 *     attendance.RecordedAt, case_reviews.reviewed_at, task_submissions.submitted_at
 *
 * A6: cases.student_lat/lng were `real` (float4 ≈ 7 significant digits ≈ ~1 m at
 *   Thai latitudes). Widen to `double precision` for production GPS accuracy.
 *
 * Idempotent (guarded on current data_type). Reversible (down restores the
 * original types; the real<-double narrowing is documented as lossy).
 */
export class NormalizeTimestampsAndCoords20260620122000 implements MigrationInterface {
  name = 'NormalizeTimestampsAndCoords20260620122000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // A5 — naive timestamp -> timestamptz (stored as UTC)
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='attendance' AND column_name='RecordedAt'
                     AND data_type='timestamp without time zone') THEN
          ALTER TABLE attendance ALTER COLUMN "RecordedAt" TYPE timestamptz USING "RecordedAt" AT TIME ZONE 'UTC';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='case_reviews' AND column_name='reviewed_at'
                     AND data_type='timestamp without time zone') THEN
          ALTER TABLE case_reviews ALTER COLUMN reviewed_at TYPE timestamptz USING reviewed_at AT TIME ZONE 'UTC';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='task_submissions' AND column_name='submitted_at'
                     AND data_type='timestamp without time zone') THEN
          ALTER TABLE task_submissions ALTER COLUMN submitted_at TYPE timestamptz USING submitted_at AT TIME ZONE 'UTC';
        END IF;
      END $$;
    `);

    // A6 — widen GPS coords real -> double precision (guard each column
    // independently so a partial-drift state still converges).
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='cases' AND column_name='student_lat' AND data_type='real') THEN
          ALTER TABLE cases ALTER COLUMN student_lat TYPE double precision;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='cases' AND column_name='student_lng' AND data_type='real') THEN
          ALTER TABLE cases ALTER COLUMN student_lng TYPE double precision;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // A6 reverse (double precision -> real is lossy but restores original type)
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='cases' AND column_name='student_lat' AND data_type='double precision') THEN
          ALTER TABLE cases ALTER COLUMN student_lat TYPE real;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='cases' AND column_name='student_lng' AND data_type='double precision') THEN
          ALTER TABLE cases ALTER COLUMN student_lng TYPE real;
        END IF;
      END $$;
    `);
    // A5 reverse (timestamptz -> naive, back to UTC wall-clock)
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='task_submissions' AND column_name='submitted_at'
                     AND data_type='timestamp with time zone') THEN
          ALTER TABLE task_submissions ALTER COLUMN submitted_at TYPE timestamp without time zone USING submitted_at AT TIME ZONE 'UTC';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='case_reviews' AND column_name='reviewed_at'
                     AND data_type='timestamp with time zone') THEN
          ALTER TABLE case_reviews ALTER COLUMN reviewed_at TYPE timestamp without time zone USING reviewed_at AT TIME ZONE 'UTC';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name='attendance' AND column_name='RecordedAt'
                     AND data_type='timestamp with time zone') THEN
          ALTER TABLE attendance ALTER COLUMN "RecordedAt" TYPE timestamp without time zone USING "RecordedAt" AT TIME ZONE 'UTC';
        END IF;
      END $$;
    `);
  }
}
