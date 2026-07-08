-- Demo subjects + weekly timetable for EVERY real (school, grade, room)
-- combination that actually has enrolled students (all 10 demo schools,
-- ~36 rooms each) — so browsing timetable for any school/grade/room in a
-- demo always shows a real populated schedule, not an empty state. The two
-- scope-locked teacher demo accounts (`suphawadi.w` ป.3/ห้อง1, `chanwit.j`
-- ป.6/ห้อง2 at school 10010002 — see seed-users.md) are wired as the real
-- teacher for their own room; every other room has no assigned teacher yet
-- (`teacher_user_id = NULL`, a real state — "ยังไม่ระบุผู้สอน" — since no
-- other teacher accounts exist to attach honestly).
-- Idempotent: subjects upsert by unique code; slots are fully owned by this
-- script (only these 8 subject codes exist in a fresh demo DB) so a rerun
-- wipes and re-inserts by subject_id rather than tracking every room.
-- Run against a DB that already has the baseline seed (schools/users/
-- school_terms/student_term).

BEGIN;

-- School 10010002's only term was left in DRAFT with a placeholder 1-day
-- range — activate it with a realistic semester-1/2569 date range so the
-- add-slot form's "ยังไม่มีเทอมที่เปิดใช้งาน" guard has a real ACTIVE term for
-- the one school an admin would actually try adding a new slot to in a demo.
UPDATE school_terms
SET status = 'ACTIVE',
    starts_on = '2026-05-16',
    ends_on = '2026-10-10',
    updated_at = now(),
    updated_by = 9 -- worapon.d, ADMIN_SCHOOL for 10010002
WHERE id = 7 AND school_id = 10010002;

INSERT INTO subjects (code, name_th, is_active, created_by, updated_by)
VALUES
  ('THAI', 'ภาษาไทย', TRUE, 9, 9),
  ('MATH', 'คณิตศาสตร์', TRUE, 9, 9),
  ('SCI', 'วิทยาศาสตร์', TRUE, 9, 9),
  ('ENG', 'ภาษาอังกฤษ', TRUE, 9, 9),
  ('SOC', 'สังคมศึกษา ศาสนา และวัฒนธรรม', TRUE, 9, 9),
  ('PE', 'สุขศึกษาและพลศึกษา', TRUE, 9, 9),
  ('ART', 'ศิลปะ', TRUE, 9, 9),
  ('CAREER', 'การงานอาชีพ', TRUE, 9, 9)
ON CONFLICT (code) DO NOTHING;

-- This script owns every row referencing these 8 subject codes (a fresh
-- demo DB has no other source for them) — wipe and re-insert on rerun.
DELETE FROM timetable_slots
WHERE subject_id IN (
  SELECT id FROM subjects WHERE code IN ('THAI', 'MATH', 'SCI', 'ENG', 'SOC', 'PE', 'ART', 'CAREER')
);

-- Every school's own current term (semester 1/2569, one per school).
INSERT INTO timetable_slots
  (school_term_id, school_id, grade_level_id, room_no, day_of_week, period, subject_id, teacher_user_id, created_by, updated_by)
SELECT
  term_map.school_term_id,
  combo.school_id,
  combo.grade_level_id,
  combo.room_no,
  pattern.day_of_week,
  pattern.period,
  subjects.id,
  CASE
    WHEN combo.school_id = 10010002 AND combo.grade_level_id = 103 AND combo.room_no = 1 THEN 12 -- suphawadi.w
    WHEN combo.school_id = 10010002 AND combo.grade_level_id = 106 AND combo.room_no = 2 THEN 13 -- chanwit.j
    ELSE NULL
  END,
  9, 9
FROM (
  SELECT DISTINCT
    s."SchoolID_Onec" AS school_id,
    s."GradeLevelID_Onec" AS grade_level_id,
    s."RoomID_Onec" AS room_no
  FROM student_term s
  -- Inner join filters out the handful of legacy rows carrying a
  -- GradeLevelID_Onec that isn't a real grade level (e.g. stray value 6).
  JOIN grade_levels gl ON gl.id = s."GradeLevelID_Onec"
  WHERE s."SchoolID_Onec" IS NOT NULL AND s."GradeLevelID_Onec" IS NOT NULL AND s."RoomID_Onec" IS NOT NULL
) AS combo
JOIN (VALUES
  (10010001, 10), (10010002, 7), (10010003, 5), (10010004, 9), (10010005, 6),
  (10010006, 8), (10010007, 3), (10010008, 4), (10010009, 2), (10010010, 1)
) AS term_map(school_id, school_term_id) ON term_map.school_id = combo.school_id
CROSS JOIN (VALUES
  (1, 1, 'THAI'), (1, 2, 'THAI'), (1, 3, 'MATH'), (1, 4, 'MATH'), (1, 5, 'SCI'), (1, 6, 'ENG'),
  (2, 1, 'MATH'), (2, 2, 'THAI'), (2, 3, 'SOC'), (2, 4, 'SOC'), (2, 5, 'PE'), (2, 6, 'ART'),
  (3, 1, 'THAI'), (3, 2, 'MATH'), (3, 3, 'SCI'), (3, 4, 'SCI'), (3, 5, 'ENG'), (3, 6, 'CAREER'),
  (4, 1, 'SOC'), (4, 2, 'THAI'), (4, 3, 'MATH'), (4, 4, 'ENG'), (4, 5, 'PE'), (4, 6, 'ART'),
  (5, 1, 'MATH'), (5, 2, 'THAI'), (5, 3, 'SCI'), (5, 4, 'SOC'), (5, 5, 'CAREER'), (5, 6, 'ART')
) AS pattern(day_of_week, period, subject_code)
JOIN subjects ON subjects.code = pattern.subject_code;

COMMIT;
