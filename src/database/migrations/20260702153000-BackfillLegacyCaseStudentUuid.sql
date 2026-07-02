-- UP
CREATE TABLE IF NOT EXISTS case_student_uuid_backfill_20260702_backup (
  case_id INTEGER PRIMARY KEY,
  old_student_uuid UUID,
  new_student_uuid UUID NOT NULL,
  matched_student_count INTEGER NOT NULL CHECK (matched_student_count = 1)
);

INSERT INTO case_student_uuid_backfill_20260702_backup (
  case_id,
  old_student_uuid,
  new_student_uuid,
  matched_student_count
)
SELECT
  c.id,
  c.student_uuid,
  matched.student_uuid,
  matched.candidate_count
FROM cases c
JOIN LATERAL (
  SELECT
    CASE
      WHEN COUNT(*) = 1 THEN (array_agg(candidate.student_uuid))[1]
      ELSE NULL
    END AS student_uuid,
    COUNT(*)::int AS candidate_count
  FROM (
    SELECT DISTINCT st.student_uuid
    FROM student_term st
    LEFT JOIN schools sc ON sc.id = st."SchoolID_Onec"
    WHERE LOWER(TRIM(CONCAT_WS(' ', st."FirstName_Onec", st."LastName_Onec"))) =
      LOWER(TRIM(c.student_name))
      AND (c.school_id IS NULL OR st."SchoolID_Onec" = c.school_id)
      AND (
        NULLIF(TRIM(COALESCE(c.student_school, '')), '') IS NULL
        OR LOWER(COALESCE(sc.name, '')) = LOWER(COALESCE(c.student_school, ''))
      )
  ) candidate
) matched ON true
WHERE c.student_uuid IS NULL
  AND c.deleted_at IS NULL
  AND matched.candidate_count = 1
  AND matched.student_uuid IS NOT NULL
ON CONFLICT (case_id) DO NOTHING;

UPDATE cases c
SET student_uuid = backup.new_student_uuid
FROM case_student_uuid_backfill_20260702_backup backup
WHERE c.id = backup.case_id
  AND c.student_uuid IS NULL;

-- DOWN
UPDATE cases c
SET student_uuid = backup.old_student_uuid
FROM case_student_uuid_backfill_20260702_backup backup
WHERE c.id = backup.case_id;

DROP TABLE IF EXISTS case_student_uuid_backfill_20260702_backup;
