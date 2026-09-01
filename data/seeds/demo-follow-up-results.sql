-- Demo follow-up trail for the home dashboard's risk charts.
--
-- The existing demo database opens cases automatically from absence thresholds
-- but almost none of them carry a visit report, so every risk chart reads as
-- "อื่น ๆ" or empty. This seed gives a slice of those cases a realistic
-- follow-up history: assigned visits, recorded problem categories and absence
-- causes, unsuccessful attempts with their reasons, closed cases with outcomes,
-- and a few agency referrals.
--
-- Idempotent: every row it writes is keyed by a deterministic token hash, so a
-- re-run removes its previous output first. Run against a demo/dev database
-- only — it moves real case rows to RESOLVED.

BEGIN;

-- ---------------------------------------------------------------- cleanup ---
CREATE TEMP TABLE demo_follow_up_links ON COMMIT DROP AS
SELECT tl.id AS link_id, tl.task_id, t.case_id
FROM task_links tl
JOIN tasks t ON t.id = tl.task_id
WHERE tl.token_hash LIKE 'demo-follow-up-%';

DELETE FROM case_referrals
WHERE case_id IN (SELECT case_id FROM demo_follow_up_links);

DELETE FROM case_reviews
WHERE case_id IN (SELECT case_id FROM demo_follow_up_links)
  AND reviewed_by = 'ระบบข้อมูลตัวอย่าง';

UPDATE cases
SET status = 'OPEN', completion_outcome_code = NULL, updated_at = now()
WHERE id IN (SELECT case_id FROM demo_follow_up_links)
  AND status = 'RESOLVED';

DELETE FROM task_submissions WHERE task_link_id IN (SELECT link_id FROM demo_follow_up_links);
DELETE FROM task_links WHERE id IN (SELECT link_id FROM demo_follow_up_links);
DELETE FROM tasks WHERE id IN (SELECT task_id FROM demo_follow_up_links);

-- ------------------------------------------------------------ case slice ---
-- A deterministic slice of open cases, each paired with a teacher from its own
-- school when there is one, so the assignment looks like real delegation.
CREATE TEMP TABLE demo_follow_up_cases ON COMMIT DROP AS
WITH ordered_cases AS (
  SELECT c.id AS case_id,
         c.school_id,
         ROW_NUMBER() OVER (ORDER BY c.id) AS seq
  FROM cases c
  WHERE c.deleted_at IS NULL
    AND c.status = 'OPEN'
    AND c.student_uuid IS NOT NULL
  LIMIT 140
),
teacher_pool AS (
  SELECT id, first_name, last_name,
         ROW_NUMBER() OVER (ORDER BY id) AS seq,
         COUNT(*) OVER () AS total
  FROM teachers
  WHERE deleted_at IS NULL AND teacher_status = 'ACTIVE'
)
SELECT
  ordered_cases.case_id,
  ordered_cases.seq,
  teacher_pool.id AS teacher_id,
  teacher_pool.first_name,
  teacher_pool.last_name,
  -- Problem mix: money and schoolwork dominate, emotional and health follow,
  -- a small tail lands in "อื่น ๆ" the way a real free-text bucket does.
  CASE
    WHEN ordered_cases.seq % 20 IN (0, 1, 2, 3, 4, 5) THEN 'FINANCIAL'
    WHEN ordered_cases.seq % 20 IN (6, 7, 8, 9) THEN 'ACADEMIC'
    WHEN ordered_cases.seq % 20 IN (10, 11, 12) THEN 'EMOTIONAL'
    WHEN ordered_cases.seq % 20 IN (13, 14) THEN 'HEALTH'
    WHEN ordered_cases.seq % 20 IN (15, 16) THEN 'SOCIAL_INTEGRATION'
    -- Slots 18 and 19 are the visits that never reached the student, so the
    -- free-text bucket sits at 17 where it can still carry a cause.
    ELSE 'OTHER'
  END AS problem_category,
  ordered_cases.seq % 20 AS slot
FROM ordered_cases
LEFT JOIN teacher_pool
  ON teacher_pool.seq = (ordered_cases.seq % GREATEST(teacher_pool.total, 1)) + 1;

-- ------------------------------------------------------------------ tasks ---
CREATE TEMP TABLE demo_follow_up_tasks ON COMMIT DROP AS
WITH inserted AS (
  INSERT INTO tasks (case_id, task_type, status, created_at, updated_at)
  SELECT case_id, 'VISIT', 'COMPLETED',
         now() - ((seq % 90) || ' days')::interval,
         now() - ((seq % 90) || ' days')::interval
  FROM demo_follow_up_cases
  RETURNING id, case_id
)
SELECT id AS task_id, case_id FROM inserted;

CREATE TEMP TABLE demo_follow_up_new_links ON COMMIT DROP AS
WITH inserted AS (
INSERT INTO task_links (
  task_id, token_hash, expires_at, status, first_used_at,
  assigned_teacher_id, assigned_to_first_name, assigned_to_last_name,
  assigned_to_name, created_at, updated_at
)
SELECT
  demo_follow_up_tasks.task_id,
  'demo-follow-up-' || md5(demo_follow_up_tasks.task_id::text),
  now() - ((slice.seq % 90) || ' days')::interval + interval '7 days',
  'COMPLETED',
  now() - ((slice.seq % 90) || ' days')::interval,
  slice.teacher_id,
  slice.first_name,
  slice.last_name,
  NULLIF(BTRIM(COALESCE(slice.first_name, '') || ' ' || COALESCE(slice.last_name, '')), ''),
  now() - ((slice.seq % 90) || ' days')::interval,
  now() - ((slice.seq % 90) || ' days')::interval
FROM demo_follow_up_tasks
JOIN demo_follow_up_cases slice ON slice.case_id = demo_follow_up_tasks.case_id
RETURNING id, task_id
)
SELECT id AS link_id, task_id FROM inserted;

-- ------------------------------------------------------------ submissions ---
INSERT INTO task_submissions (
  task_link_id, task_execution_outcome_code, non_follow_up_reason_code,
  follow_up_problem_category_code, absence_reason_code, absence_reason_category_code,
  cause_detail, visited_at, submitted_at, created_at, updated_at
)
SELECT
  links.link_id,
  -- Roughly one in five visits does not reach the student.
  CASE WHEN slice.slot IN (18, 19) THEN 'NOT_SUCCEEDED' ELSE 'SUCCEEDED' END,
  CASE slice.slot
    WHEN 18 THEN 'UNREACHABLE'
    WHEN 19 THEN 'MOVED_WITHOUT_NOTICE'
    ELSE NULL
  END,
  -- An unsuccessful visit never establishes a cause.
  CASE WHEN slice.slot IN (18, 19) THEN NULL ELSE slice.problem_category END,
  CASE WHEN slice.slot IN (18, 19) THEN NULL ELSE
    CASE slice.problem_category
      WHEN 'FINANCIAL' THEN CASE WHEN slice.seq % 2 = 0 THEN 'PART_TIME_WORK' ELSE 'NO_LEARNING_EQUIPMENT' END
      WHEN 'ACADEMIC' THEN 'AFRAID_OF_TEACHER'
      WHEN 'EMOTIONAL' THEN CASE WHEN slice.seq % 2 = 0 THEN 'EMOTIONAL_PROBLEM' ELSE 'SLEEP_LATE' END
      WHEN 'HEALTH' THEN 'MINOR_ILLNESS'
      WHEN 'SOCIAL_INTEGRATION' THEN 'BULLIED'
      ELSE 'UNKNOWN'
    END
  END,
  CASE WHEN slice.slot IN (18, 19) THEN NULL ELSE
    CASE slice.problem_category
      WHEN 'FINANCIAL' THEN 'ECONOMIC'
      WHEN 'ACADEMIC' THEN 'LEARNING_SCHOOL'
      WHEN 'EMOTIONAL' THEN 'MENTAL_BEHAVIOR'
      WHEN 'HEALTH' THEN 'PERSONAL_FAMILY'
      WHEN 'SOCIAL_INTEGRATION' THEN 'LEARNING_SCHOOL'
      ELSE NULL
    END
  END,
  -- Free text only where the fixed list has no row for the situation, which is
  -- what makes the "อื่น ๆ" bucket readable on the dashboard.
  CASE WHEN slice.problem_category = 'OTHER' AND slice.slot NOT IN (18, 19) THEN
    CASE (slice.seq / 20) % 4
      WHEN 0 THEN 'ครอบครัวย้ายตามงานตามฤดูกาล นักเรียนต้องเดินทางไปกับผู้ปกครอง'
      WHEN 1 THEN 'ผู้ปกครองต้องดูแลผู้ป่วยติดเตียงที่บ้าน นักเรียนช่วยดูแลน้อง'
      WHEN 2 THEN 'บ้านอยู่ไกลและไม่มีรถรับส่งในช่วงฤดูฝน'
      ELSE 'นักเรียนช่วยงานร้านของครอบครัวในวันที่มีตลาดนัด'
    END
  END,
  now() - ((slice.seq % 90) || ' days')::interval,
  now() - ((slice.seq % 90) || ' days')::interval,
  now() - ((slice.seq % 90) || ' days')::interval,
  now() - ((slice.seq % 90) || ' days')::interval
FROM demo_follow_up_new_links links
JOIN demo_follow_up_tasks ON demo_follow_up_tasks.task_id = links.task_id
JOIN demo_follow_up_cases slice ON slice.case_id = demo_follow_up_tasks.case_id;

-- --------------------------------------------------------- closed outcomes ---
-- Every fourth successful visit ends with the case actually closed, so the
-- outcome chart has something to compare problem categories against.
CREATE TEMP TABLE demo_follow_up_closed ON COMMIT DROP AS
SELECT case_id, seq, problem_category
FROM demo_follow_up_cases
WHERE slot NOT IN (18, 19) AND seq % 4 = 0;

UPDATE cases
SET status = 'RESOLVED', completion_outcome_code = 'CLOSED', updated_at = now() - ((seq % 60) || ' days')::interval
FROM demo_follow_up_closed
WHERE cases.id = demo_follow_up_closed.case_id;

CREATE TEMP TABLE demo_follow_up_reviews ON COMMIT DROP AS
WITH inserted AS (
INSERT INTO case_reviews (case_id, review_action, resolution_outcome, review_summary, reviewed_by, reviewed_at)
SELECT
  case_id,
  'CLOSE',
  -- Most closed cases end with the student back in class; the rest split
  -- between transfers, illness, and family work.
  CASE seq % 40
    WHEN 0 THEN 'TRANSFERRED_SCHOOL'
    WHEN 20 THEN 'ILLNESS'
    WHEN 28 THEN 'WORKING'
    ELSE 'RETURNED_TO_SCHOOL'
  END,
  CASE problem_category
    WHEN 'FINANCIAL' THEN 'ประสานทุนช่วยเหลือและค่าเดินทาง นักเรียนกลับมาเรียนต่อเนื่อง'
    WHEN 'ACADEMIC' THEN 'จัดสอนเสริมและติดตามผลการเรียนร่วมกับครูประจำวิชา'
    WHEN 'EMOTIONAL' THEN 'ส่งพบครูแนะแนวและติดตามอาการร่วมกับผู้ปกครอง'
    WHEN 'HEALTH' THEN 'ติดตามการรักษาและปรับตารางเรียนให้เหมาะกับอาการ'
    ELSE 'ประสานผู้ปกครองและติดตามการมาเรียนอย่างต่อเนื่อง'
  END,
  'ระบบข้อมูลตัวอย่าง',
  now() - ((seq % 60) || ' days')::interval
FROM demo_follow_up_closed
RETURNING id, case_id
)
SELECT id AS review_id, case_id FROM inserted;

-- -------------------------------------------------------------- referrals ---
INSERT INTO case_referrals (case_review_id, case_id, referral_agency_id, status_code, referred_at, referral_note)
SELECT
  reviews.review_id,
  reviews.case_id,
  agency.id,
  CASE closed.seq % 3
    WHEN 0 THEN 'COMPLETED'
    WHEN 1 THEN 'ACCEPTED'
    ELSE 'REFERRED'
  END,
  now() - ((closed.seq % 60) || ' days')::interval,
  'ประสานหน่วยงานภายนอกเพื่อช่วยเหลือต่อเนื่อง'
FROM demo_follow_up_reviews reviews
JOIN demo_follow_up_closed closed ON closed.case_id = reviews.case_id
JOIN LATERAL (
  SELECT id FROM referral_agencies
  WHERE is_active = TRUE
  ORDER BY id
  OFFSET (closed.seq % GREATEST((SELECT COUNT(*) FROM referral_agencies WHERE is_active = TRUE), 1))
  LIMIT 1
) agency ON TRUE
-- Referral is the exception, not the rule: one closed case in three.
WHERE closed.seq % 12 = 0;

-- ------------------------------------------------- legacy row correction ---
-- The old `cause_category` backfill mapped anything it did not recognise to
-- OTHER, so reports whose own text names the cause were filed under the
-- catch-all. Re-file the ones whose text is unambiguous.
UPDATE task_submissions
SET follow_up_problem_category_code = 'FINANCIAL',
    absence_reason_category_code = 'ECONOMIC',
    updated_at = now()
WHERE deleted_at IS NULL
  AND follow_up_problem_category_code = 'OTHER'
  AND cause_detail ILIKE '%รายได้%';

COMMIT;
