-- Demo subjects + weekly timetable for EVERY real (school, grade, room)
-- combination that actually has enrolled students (all 10 demo schools,
-- ~36 rooms each) — so browsing timetable for any school/grade/room in a
-- demo always shows a real populated schedule, not an empty state.
-- Every slot resolves its teacher from the active homeroom assignment, so
-- actor provenance remains valid across databases without hardcoded user IDs.
-- Idempotent: subjects upsert by unique code; weekday periods 1-6 for each
-- current demo roster are upserted by the database's active-slot key.
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
    updated_by = (
      SELECT id FROM users
      WHERE username = 'worapon.d' AND data_origin_code = 'DEMO'
    )
WHERE id = 7 AND school_id = 10010002;

WITH actor AS (
  SELECT id FROM users
  WHERE username = 'orathai.b' AND data_origin_code = 'DEMO'
)
INSERT INTO subjects (code, name_th, is_active, created_by, updated_by)
SELECT input.code, input.name_th, TRUE, actor.id, actor.id
FROM (VALUES
  ('THAI', 'ภาษาไทย'),
  ('MATH', 'คณิตศาสตร์'),
  ('SCI', 'วิทยาศาสตร์'),
  ('ENG', 'ภาษาอังกฤษ'),
  ('SOC', 'สังคมศึกษา ศาสนา และวัฒนธรรม'),
  ('PE', 'สุขศึกษาและพลศึกษา'),
  ('ART', 'ศิลปะ'),
  ('CAREER', 'การงานอาชีพ')
) AS input(code, name_th)
CROSS JOIN actor
ON CONFLICT (code) DO NOTHING;

-- Every school's own current term (semester 1/2569, one per school).
WITH actor AS (
  SELECT id FROM users
  WHERE username = 'orathai.b' AND data_origin_code = 'DEMO'
)
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
  homeroom.teacher_user_id,
  actor.id, actor.id
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
JOIN LATERAL (
  SELECT term.id AS school_term_id
  FROM school_terms term
  WHERE term.school_id = combo.school_id
    AND term.status = 'ACTIVE'
    AND term.deleted_at IS NULL
  ORDER BY term.academic_year DESC, term.semester DESC, term.id DESC
  LIMIT 1
) AS term_map ON TRUE
LEFT JOIN LATERAL (
  SELECT teacher.id AS teacher_user_id
  FROM school_classrooms classroom
  JOIN classroom_teacher_assignments assignment
    ON assignment.classroom_id = classroom.id
   AND assignment.assignment_kind = 'HOMEROOM'
   AND assignment.assignment_status = 'ACTIVE'
   AND assignment.deleted_at IS NULL
  JOIN school_teacher_memberships membership
    ON membership.id = assignment.teacher_membership_id
   AND membership.membership_status = 'ACTIVE'
   AND membership.deleted_at IS NULL
  JOIN users teacher
    ON teacher.id = membership.teacher_user_id
   AND teacher.status = 'ACTIVE'
   AND teacher.data_origin_code = 'DEMO'
  WHERE classroom.school_term_id = term_map.school_term_id
    AND classroom.school_id = combo.school_id
    AND classroom.grade_level_id = combo.grade_level_id
    AND classroom.legacy_room_number = combo.room_no
    AND classroom.classroom_status = 'ACTIVE'
    AND classroom.deleted_at IS NULL
  ORDER BY assignment.effective_on DESC, assignment.id DESC
  LIMIT 1
) AS homeroom ON TRUE
CROSS JOIN actor
CROSS JOIN (VALUES
  (1, 1, 'THAI'), (1, 2, 'THAI'), (1, 3, 'MATH'), (1, 4, 'MATH'), (1, 5, 'SCI'), (1, 6, 'ENG'),
  (2, 1, 'MATH'), (2, 2, 'THAI'), (2, 3, 'SOC'), (2, 4, 'SOC'), (2, 5, 'PE'), (2, 6, 'ART'),
  (3, 1, 'THAI'), (3, 2, 'MATH'), (3, 3, 'SCI'), (3, 4, 'SCI'), (3, 5, 'ENG'), (3, 6, 'CAREER'),
  (4, 1, 'SOC'), (4, 2, 'THAI'), (4, 3, 'MATH'), (4, 4, 'ENG'), (4, 5, 'PE'), (4, 6, 'ART'),
  (5, 1, 'MATH'), (5, 2, 'THAI'), (5, 3, 'SCI'), (5, 4, 'SOC'), (5, 5, 'CAREER'), (5, 6, 'ART')
) AS pattern(day_of_week, period, subject_code)
JOIN subjects ON subjects.code = pattern.subject_code
ON CONFLICT (
  school_term_id, school_id, grade_level_id, room_no, day_of_week, period
) WHERE deleted_at IS NULL
DO UPDATE SET
  subject_id = EXCLUDED.subject_id,
  teacher_user_id = EXCLUDED.teacher_user_id,
  updated_by = EXCLUDED.updated_by,
  updated_at = now();

COMMIT;
