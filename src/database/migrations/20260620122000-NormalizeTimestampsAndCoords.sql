-- Migration: NormalizeTimestampsAndCoords20260620122000
-- A5: convert the 3 remaining naive timestamps to timestamptz (server stores UTC).
--     attendance.RecordedAt, case_reviews.reviewed_at, task_submissions.submitted_at
-- A6: widen cases.student_lat/lng from real -> double precision (GPS precision).
-- Idempotent (guarded on data_type). Reversible (down restores original types).

-- == up ==
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='attendance' AND column_name='RecordedAt' AND data_type='timestamp without time zone') THEN
    ALTER TABLE attendance ALTER COLUMN "RecordedAt" TYPE timestamptz USING "RecordedAt" AT TIME ZONE 'UTC';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='case_reviews' AND column_name='reviewed_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE case_reviews ALTER COLUMN reviewed_at TYPE timestamptz USING reviewed_at AT TIME ZONE 'UTC';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='task_submissions' AND column_name='submitted_at' AND data_type='timestamp without time zone') THEN
    ALTER TABLE task_submissions ALTER COLUMN submitted_at TYPE timestamptz USING submitted_at AT TIME ZONE 'UTC';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='cases' AND column_name='student_lat' AND data_type='real') THEN
    ALTER TABLE cases ALTER COLUMN student_lat TYPE double precision;
    ALTER TABLE cases ALTER COLUMN student_lng TYPE double precision;
  END IF;
END $$;

-- == down ==
-- cases.student_lat/lng double precision -> real (lossy);
-- the 3 timestamptz columns -> timestamp without time zone via AT TIME ZONE 'UTC'.
