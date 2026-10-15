import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Presentation data for โรงเรียนบูรพา (owner, 2026-10-15) — data only, no
 * schema. Every open case is closed through the normal workflow (teacher
 * report, director close) or, for auto-opened cases nobody worked on,
 * cancelled the way the absence monitor does when attendance is corrected;
 * open watches are closed by the director; attendance is filled for every
 * school day 2026-08-11..2026-10-15 from each classroom's own weekly timetable
 * and every current student is absent exactly two full days after their
 * latest closed case, so one more absence opens a case. The term is extended
 * to 2026-10-31 so check-ins after 10 Oct are accepted.
 *
 * Safe to run again (it only touches what is still open or missing) and
 * skipped on databases without the school, director, or active term. A
 * failure rolls the reset back and is logged instead of failing the deploy.
 * Irreversible: down() does nothing.
 */
export class ResetBuraphaPresentationData20261015130000 implements MigrationInterface {
  name = 'ResetBuraphaPresentationData20261015130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const ready = (await queryRunner.query(`
      SELECT 1
      FROM school_terms term
      JOIN users director ON director.username = 'burapha.director'
      JOIN users admin ON admin.username = 'burapha.admin'
      WHERE term.school_id = 10010004 AND term.status = 'ACTIVE' AND term.deleted_at IS NULL
    `)) as unknown[];
    if (ready.length !== 1) return;
    // Presentation data must never keep the backend from starting: on any
    // failure the reset is rolled back and the deploy carries on unchanged.
    await queryRunner.query('SAVEPOINT reset_burapha_presentation');
    try {
      await queryRunner.query(RESET_SQL);
      await queryRunner.query('RELEASE SAVEPOINT reset_burapha_presentation');
    } catch (error) {
      await queryRunner.query('ROLLBACK TO SAVEPOINT reset_burapha_presentation');
      console.error(
        `ResetBuraphaPresentationData skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async down(): Promise<void> {
    // Data reset; the previous case and attendance state is not kept.
  }
}

export const RESET_SQL = `
CREATE OR REPLACE FUNCTION pg_temp.bkk(d date, hh int, mm int) RETURNS timestamptz
LANGUAGE sql IMMUTABLE AS $$ SELECT ((d + make_time(hh, mm, 0)) AT TIME ZONE 'Asia/Bangkok') $$;
CREATE OR REPLACE FUNCTION pg_temp.h(t text) RETURNS int
LANGUAGE sql IMMUTABLE AS $$ SELECT abs(hashtext(t)) $$;
CREATE OR REPLACE FUNCTION pg_temp.pick(arr text[], seed text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$ SELECT arr[1 + pg_temp.h(seed) % array_length(arr, 1)] $$;

ALTER TABLE cases DISABLE TRIGGER trg_cases_set_updated_at;
ALTER TABLE case_reviews DISABLE TRIGGER trg_case_reviews_set_updated_at;
ALTER TABLE tasks DISABLE TRIGGER trg_tasks_set_updated_at;
ALTER TABLE task_links DISABLE TRIGGER trg_task_links_set_updated_at;
ALTER TABLE task_submissions DISABLE TRIGGER trg_task_submissions_set_updated_at;
ALTER TABLE attendance_sessions DISABLE TRIGGER trg_attendance_sessions_set_updated_at;
ALTER TABLE attendance_exceptions DISABLE TRIGGER trg_attendance_exceptions_set_updated_at;

CREATE TEMP TABLE ctx ON COMMIT DROP AS
SELECT 10010004::int AS school_id,
       (SELECT id FROM school_terms WHERE school_id = 10010004 AND status = 'ACTIVE' AND deleted_at IS NULL) AS term_id,
       u.id AS director_id,
       u.username AS director_username,
       trim(u."FirstName" || ' ' || u."LastName") AS director_name,
       (SELECT id FROM users WHERE username = 'burapha.admin') AS admin_id,
       '{"districts":["เมืองชลบุรี"],"provinces":["ชลบุรี"],"school_ids":[10010004],"sub_districts":["แสนสุข"]}'::jsonb AS scope
FROM users u WHERE u.username = 'burapha.director';

DO $$ BEGIN
  IF (SELECT count(*) FROM ctx WHERE term_id IS NOT NULL AND director_id IS NOT NULL AND admin_id IS NOT NULL) <> 1 THEN
    RAISE EXCEPTION 'context incomplete';
  END IF;
END $$;

-- 0. The term must cover the history and the presentation check-ins.
UPDATE school_terms SET ends_on = DATE '2026-10-31', updated_at = now(), updated_by = (SELECT admin_id FROM ctx)
WHERE id = (SELECT term_id FROM ctx) AND ends_on < DATE '2026-10-31';

-- 1. Cases -------------------------------------------------------------------
CREATE TEMP TABLE target_cases ON COMMIT DROP AS
SELECT c.id, c.status, c.workflow_phase_code, c.student_uuid, c.person_uuid, c.student_name,
       c.student_lat, c.student_lng,
       (c.created_by IS NULL AND c.created_by_teacher_id IS NULL) AS auto_opened,
       EXISTS (SELECT 1 FROM tasks t WHERE t.case_id = c.id AND t.deleted_at IS NULL) AS has_tasks
FROM cases c
WHERE c.school_id = (SELECT school_id FROM ctx) AND c.deleted_at IS NULL AND c.status <> 'RESOLVED';

-- Assignments made to a test account go to the student's homeroom teacher.
CREATE TEMP TABLE test_links ON COMMIT DROP AS
WITH homeroom AS (
  SELECT DISTINCT ON (s.student_uuid) s.student_uuid, te.id AS teacher_id,
         trim(te.first_name || ' ' || te.last_name) AS name, te.email
  FROM student_term s
  JOIN classroom_homeroom_teacher_assignments a ON a.classroom_id = s.classroom_id
  JOIN school_teacher_memberships m ON m.id = a.teacher_membership_id
  JOIN teachers te ON te.id = m.teacher_id
  WHERE s."SchoolID_Onec" = (SELECT school_id FROM ctx)
  ORDER BY s.student_uuid, a.is_primary DESC
)
SELECT l.id AS link_id, c.id AS case_id, trim(old.first_name || ' ' || old.last_name) AS old_name,
       h.teacher_id, h.name, h.email
FROM task_links l
JOIN tasks t ON t.id = l.task_id
JOIN cases c ON c.id = t.case_id
JOIN teachers old ON old.id = l.assigned_teacher_id
JOIN homeroom h ON h.student_uuid = c.student_uuid
WHERE c.school_id = (SELECT school_id FROM ctx)
  AND (old.first_name ILIKE 'test%' OR old.last_name ILIKE 'test%');
UPDATE task_links l SET assigned_teacher_id = x.teacher_id, assigned_to_name = x.name, assigned_to_email = x.email
FROM test_links x WHERE l.id = x.link_id;
UPDATE notifications n SET reason_text = replace(n.reason_text, x.old_name, x.name)
FROM test_links x WHERE n.case_id = x.case_id AND n.reason_text LIKE '%' || x.old_name || '%';

-- Work recorded today on a case that is about to be closed in the past moves
-- back two weeks so the story stays in order (assignment -> visit -> close).
CREATE TEMP TABLE moved_tasks ON COMMIT DROP AS
SELECT t.id FROM tasks t JOIN target_cases tc ON tc.id = t.case_id
WHERE t.deleted_at IS NULL AND t.created_at >= pg_temp.bkk(DATE '2026-10-13', 0, 0);
UPDATE task_links l SET created_at = l.created_at - interval '14 days', updated_at = l.updated_at - interval '14 days',
       expires_at = l.expires_at - interval '14 days'
WHERE l.task_id IN (SELECT id FROM moved_tasks);
UPDATE tasks t SET created_at = t.created_at - interval '14 days', updated_at = t.updated_at - interval '14 days'
WHERE t.id IN (SELECT id FROM moved_tasks);
UPDATE notifications n SET created_at = n.created_at - interval '14 days'
WHERE n.case_id IN (SELECT id FROM target_cases) AND n.case_status_code = 'IN_PROGRESS'
  AND n.created_at >= pg_temp.bkk(DATE '2026-10-13', 0, 0);

-- 1a. Auto-opened cases nobody worked on: cancelled like the absence monitor.
CREATE TEMP TABLE cancel_cases ON COMMIT DROP AS
SELECT id, student_uuid FROM target_cases
WHERE status = 'OPEN' AND auto_opened AND NOT has_tasks;
UPDATE cases SET deleted_at = now() WHERE id IN (SELECT id FROM cancel_cases);
DELETE FROM notifications WHERE case_id IN (SELECT id FROM cancel_cases);
INSERT INTO audit_log (actor_user_id, actor_label, action, target_type, target_id, metadata, ip, created_at, data_origin_code)
SELECT NULL, 'system:absence-monitor', 'CASE_AUTO_CANCEL', 'case', id::text,
       jsonb_build_object('reason', 'attendance_corrected', 'studentUuid', student_uuid), NULL, now(), 'OPERATIONAL'
FROM cancel_cases;

-- 1b. Everything else walks the real workflow to RESOLVED.
CREATE TEMP TABLE close_cases ON COMMIT DROP AS
SELECT tc.*,
  greatest(
    (SELECT created_at FROM cases WHERE id = tc.id),
    (SELECT max(reviewed_at) FROM case_reviews r WHERE r.case_id = tc.id),
    (SELECT max(l.created_at) FROM task_links l JOIN tasks t ON t.id = l.task_id WHERE t.case_id = tc.id AND t.deleted_at IS NULL),
    (SELECT max(s.submitted_at) FROM task_submissions s JOIN task_links l ON l.id = s.task_link_id JOIN tasks t ON t.id = l.task_id WHERE t.case_id = tc.id),
    (SELECT max(referred_at) FROM case_referrals r WHERE r.case_id = tc.id)
  ) AS last_act
FROM target_cases tc WHERE tc.id NOT IN (SELECT id FROM cancel_cases);

CREATE TEMP TABLE notif_recipients ON COMMIT DROP AS
SELECT DISTINCT n.case_id, n.recipient_user_id FROM notifications n WHERE n.case_id IN (SELECT id FROM close_cases);

DO $$
DECLARE
  cx record; c record; st text; steps text[]; n int; k int;
  t_start timestamptz; t_end timestamptz; d_close date; ts timestamptz;
  v_link record; v_task uuid; v_link_id uuid; v_teacher record; v_sub int; v_review uuid; v_ref record; v_ref_id uuid;
  v_reason text; v_cat text; v_fup text; v_cause text; v_parental text; v_guard text; v_contact text;
  v_note text; v_summary text; v_type text; latest_ok boolean;
  causes text[][] := ARRAY[
    ARRAY['MINOR_ILLNESS','PERSONAL_FAMILY','HEALTH','นักเรียนป่วยเป็นไข้หวัดและท้องเสียต่อเนื่องหลายวัน ผู้ปกครองพาไปรักษาที่ รพ.สต. แล้ว ตอนนี้อาการดีขึ้นและพร้อมกลับมาเรียน'],
    ARRAY['FAMILY_PROBLEM','PERSONAL_FAMILY','FAMILY_CARE','พ่อแม่แยกกันอยู่ นักเรียนย้ายมาอยู่กับยาย บางวันต้องช่วยดูแลน้อง จึงมาเรียนไม่สม่ำเสมอ ยายรับปากจะดูแลให้มาเรียนทุกวัน'],
    ARRAY['PART_TIME_WORK','ECONOMIC','FINANCIAL','นักเรียนช่วยครอบครัวขายของที่ตลาดช่วงเช้า ทำให้มาโรงเรียนไม่ทัน ได้ตกลงกับผู้ปกครองให้ช่วยงานเฉพาะวันหยุด'],
    ARRAY['SLEEP_LATE','MENTAL_BEHAVIOR','ATTENDANCE','นักเรียนเล่นโทรศัพท์จนดึกแล้วตื่นสาย ได้ตกลงกับผู้ปกครองเรื่องเวลานอน และให้ผู้ปกครองปลุกและพามาส่งทุกเช้า'],
    ARRAY['BULLIED','LEARNING_SCHOOL','SOCIAL_INTEGRATION','นักเรียนไม่อยากมาโรงเรียนเพราะมีปัญหากับเพื่อนในห้อง ครูได้พูดคุยและไกล่เกลี่ยกับเพื่อนแล้ว นักเรียนสบายใจขึ้น'],
    ARRAY['NO_LEARNING_EQUIPMENT','ECONOMIC','FINANCIAL','ชุดนักเรียนและรองเท้าชำรุด นักเรียนอายที่จะมาโรงเรียน โรงเรียนประสานมอบชุดนักเรียนและอุปกรณ์การเรียนให้แล้ว'],
    ARRAY['ADVERSE_WEATHER','SOCIAL_ENVIRONMENT','SAFETY','ช่วงฝนตกหนักถนนเข้าหมู่บ้านน้ำท่วมขัง เดินทางมาโรงเรียนลำบาก ตอนนี้น้ำลดแล้ว ผู้ปกครองจะขับรถจักรยานยนต์มาส่ง'],
    ARRAY['EMOTIONAL_PROBLEM','MENTAL_BEHAVIOR','EMOTIONAL','นักเรียนมีความเครียดเรื่องการเรียนและเบื่อหน่าย ได้พูดคุยให้กำลังใจ และประสานครูแนะแนวดูแลต่อเนื่อง']
  ];
  recs text[] := ARRAY[
    'ติดตามการมาเรียนต่อเนื่อง 2 สัปดาห์ หากขาดเรียนให้โทรประสานผู้ปกครองทันที',
    'ให้ครูประจำชั้นสอบถามความเป็นอยู่ทุกสัปดาห์ และแจ้งผู้ปกครองทางไลน์เมื่อมีการขาดเรียน',
    'ดูแลใกล้ชิดในห้องเรียน และนัดผู้ปกครองพูดคุยอีกครั้งปลายเดือน'];
  close_notes text[] := ARRAY[
    'นักเรียนกลับมาเรียนสม่ำเสมอแล้ว ผู้ปกครองให้ความร่วมมือดี ปิดเคส ให้ครูประจำชั้นติดตามการมาเรียนตามปกติ',
    'ตรวจรายงานการเยี่ยมบ้านแล้ว สาเหตุได้รับการแก้ไข นักเรียนมาเรียนตามปกติ ปิดเคส',
    'รับทราบผลการติดตาม นักเรียนมาเรียนต่อเนื่อง ไม่พบปัจจัยเสี่ยงเพิ่ม ปิดเคส',
    'ครอบครัวรับปากดูแลเรื่องการมาเรียน นักเรียนมาเรียนครบทุกวันในสัปดาห์ที่ผ่านมา ปิดเคส'];
  parentals text[] := ARRAY['LIVING_TOGETHER','LIVING_TOGETHER','LIVING_TOGETHER','LIVING_APART','DIVORCED'];
  guards text[] := ARRAY['MOTHER','FATHER,MOTHER','MOTHER','MATERNAL_GRANDPARENT','FATHER'];
BEGIN
  SELECT * INTO cx FROM ctx;
  FOR c IN SELECT * FROM close_cases ORDER BY id LOOP
    st := c.status;
    latest_ok := (
      SELECT s.task_execution_outcome_code = 'SUCCEEDED'
      FROM task_submissions s JOIN task_links l ON l.id = s.task_link_id JOIN tasks t ON t.id = l.task_id
      WHERE t.case_id = c.id AND s.deleted_at IS NULL ORDER BY s.submitted_at DESC, s.id DESC LIMIT 1);
    SELECT l.id, l.task_id, t.task_type INTO v_link
    FROM task_links l JOIN tasks t ON t.id = l.task_id
    WHERE t.case_id = c.id AND l.status = 'ACTIVE' AND l.deleted_at IS NULL AND t.deleted_at IS NULL
    ORDER BY l.created_at DESC LIMIT 1;

    steps := CASE
      WHEN st = 'OPEN' THEN ARRAY['ASSIGN','SUBMIT','CLOSE']
      WHEN st = 'IN_PROGRESS' AND v_link.id IS NOT NULL THEN ARRAY['SUBMIT','CLOSE']
      WHEN st = 'IN_PROGRESS' THEN ARRAY['ASSIGN','SUBMIT','CLOSE']
      WHEN st = 'PENDING_REVIEW' AND coalesce(latest_ok, false) THEN ARRAY['CLOSE']
      WHEN st IN ('PENDING_REVIEW','STUDENT_NOT_FOUND','REFERRAL_NOT_SUCCEEDED') THEN ARRAY['CONTINUE','ASSIGN','SUBMIT','CLOSE']
      WHEN st = 'AWAITING_REFERRAL' THEN ARRAY['REFER','RESULT','CLOSE']
      WHEN st = 'AWAITING_REFERRAL_OUTCOME' THEN ARRAY['RESULT','CLOSE']
      ELSE NULL END;
    IF steps IS NULL THEN RAISE EXCEPTION 'case % has unhandled status %', c.id, st; END IF;

    -- Close on a weekday, 3-6 days after the last real activity, no later than
    -- 2026-10-12 so two school days (14, 15 Oct) remain for the absences.
    d_close := least((c.last_act AT TIME ZONE 'Asia/Bangkok')::date + 3 + pg_temp.h('close' || c.id) % 4, DATE '2026-10-12');
    WHILE extract(isodow FROM d_close) > 5 OR d_close = DATE '2026-10-13' LOOP d_close := d_close + 1; END LOOP;
    IF d_close > DATE '2026-10-12' THEN d_close := DATE '2026-10-12'; END IF;
    t_start := c.last_act + interval '2 hours';
    t_end := pg_temp.bkk(d_close, 15, 10 + pg_temp.h('m' || c.id) % 40);
    IF t_end <= t_start THEN RAISE EXCEPTION 'case % has no room before %', c.id, d_close; END IF;
    n := array_length(steps, 1);

    FOR k IN 1..n LOOP
      ts := CASE WHEN k = n THEN t_end ELSE t_start + (t_end - t_start) * k / (n + 1) END;
      -- keep intermediate work inside school hours
      IF k < n THEN
        ts := pg_temp.bkk((ts AT TIME ZONE 'Asia/Bangkok')::date, 9 + pg_temp.h(steps[k] || c.id) % 7, pg_temp.h('mm' || steps[k] || c.id) % 60);
        IF ts <= t_start THEN ts := t_start + interval '30 minutes' * k; END IF;
        IF ts >= t_end THEN ts := t_end - interval '1 hour' * (n - k); END IF;
      END IF;

      IF steps[k] = 'CONTINUE' THEN
        v_note := pg_temp.pick(ARRAY['ให้ครูประจำชั้นลงพื้นที่ติดตามอีกครั้ง ประสานผู้ปกครองก่อนเข้าเยี่ยมบ้าน',
                                     'ยังไม่พบสาเหตุชัดเจน ให้ครูติดตามเยี่ยมบ้านอีกรอบและพูดคุยกับผู้ปกครองโดยตรง'], 'cont' || c.id);
        INSERT INTO case_reviews (id, case_id, review_action, review_note, reviewed_by, reviewed_at, created_at, updated_at, created_by, updated_by, source_actor_user_id)
        VALUES (gen_random_uuid(), c.id, 'CONTINUE', v_note, cx.director_name, ts, ts, ts, cx.director_id, cx.director_id, cx.director_id);
        UPDATE cases SET status = 'IN_PROGRESS', completion_outcome_code = NULL, updated_at = ts, updated_by = cx.director_id WHERE id = c.id;
        INSERT INTO audit_log (actor_user_id, actor_label, action, target_type, target_id, metadata, ip, created_at, data_origin_code)
        VALUES (cx.director_id, cx.director_username, 'CASE_REVIEW', 'case', c.id::text,
          jsonb_build_object('reviewAction','CONTINUE','referralAgencyId',NULL,'completionOutcome',NULL,'resolutionOutcome',NULL,'targetWorkflowPhase',NULL,'proposedAssistanceMeasureCodes','[]'::jsonb), NULL, ts, 'OPERATIONAL');
        INSERT INTO notifications (id, recipient_user_id, type_code, title, body, ref_entity, ref_id, seen_at, read_at, created_at, case_id, student_name_snapshot, reason_text, case_status_code)
        SELECT gen_random_uuid(), r.recipient_user_id, 'CASE_STATUS_CHANGED', 'เคสเปลี่ยนสถานะ: รอติดตาม', c.student_name, 'case', c.id::text,
               ts + interval '3 hours', ts + interval '3 hours', ts, c.id, c.student_name, 'มอบหมายการติดตามแล้ว', 'IN_PROGRESS'
        FROM notif_recipients r WHERE r.case_id = c.id AND r.recipient_user_id <> cx.director_id;

      ELSIF steps[k] = 'ASSIGN' THEN
        SELECT te.id, trim(te.first_name || ' ' || te.last_name) AS name, te.email INTO v_teacher
        FROM teachers te
        WHERE te.id = coalesce(
          (SELECT l.assigned_teacher_id FROM task_links l JOIN tasks t ON t.id = l.task_id
           WHERE t.case_id = c.id AND l.assigned_teacher_id IS NOT NULL ORDER BY l.created_at DESC LIMIT 1),
          (SELECT m.teacher_id FROM student_term s
           JOIN classroom_homeroom_teacher_assignments a ON a.classroom_id = s.classroom_id
           JOIN school_teacher_memberships m ON m.id = a.teacher_membership_id
           WHERE s.student_uuid = c.student_uuid ORDER BY a.is_primary DESC LIMIT 1));
        IF v_teacher.id IS NULL THEN RAISE EXCEPTION 'case % has no teacher to assign', c.id; END IF;
        v_task := gen_random_uuid(); v_link_id := gen_random_uuid();
        INSERT INTO tasks (id, case_id, status, created_at, task_type, target_school_id, updated_at, created_by, updated_by)
        VALUES (v_task, c.id, 'IN_PROGRESS', ts, 'VISIT', cx.school_id, ts, cx.director_id, cx.director_id);
        INSERT INTO task_links (id, task_id, token_hash, assigned_to_name, assigned_to_email, status, admin_locked, expires_at, created_at, created_by, updated_at, updated_by, assigned_teacher_id, line_delivery_status, line_delivery_attempt_count)
        VALUES (v_link_id, v_task, encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'),
                v_teacher.name, v_teacher.email, 'ACTIVE', 0, ts + interval '30 days', ts, cx.director_id, ts, cx.director_id, v_teacher.id, 'NOT_READY', 0);
        UPDATE cases SET status = 'IN_PROGRESS', updated_at = ts, updated_by = cx.director_id WHERE id = c.id;
        INSERT INTO audit_log (actor_user_id, actor_label, action, target_type, target_id, metadata, ip, created_at, data_origin_code)
        VALUES (cx.director_id, cx.director_username, 'TASK_CREATE', 'task', v_task::text,
          jsonb_build_object('room',NULL,'grade',NULL,'scope',cx.scope,'caseId',c.id,'schoolId',cx.school_id,'taskType','VISIT'), NULL, ts, 'OPERATIONAL');
        INSERT INTO notifications (id, recipient_user_id, type_code, title, body, ref_entity, ref_id, seen_at, read_at, created_at, case_id, student_name_snapshot, reason_text, case_status_code)
        SELECT gen_random_uuid(), r.recipient_user_id, 'CASE_STATUS_CHANGED', 'เคสเปลี่ยนสถานะ: รอติดตาม', c.student_name, 'case', c.id::text,
               ts + interval '3 hours', ts + interval '3 hours', ts, c.id, c.student_name, 'มอบหมายให้: ' || v_teacher.name, 'IN_PROGRESS'
        FROM notif_recipients r WHERE r.case_id = c.id AND r.recipient_user_id <> cx.director_id;
        v_link.id := v_link_id; v_link.task_id := v_task; v_link.task_type := 'VISIT';

      ELSIF steps[k] = 'SUBMIT' THEN
        v_type := v_link.task_type;
        IF v_type = 'ASSIST' THEN
          v_summary := pg_temp.pick(ARRAY[
            'จัดครูพี่เลี้ยงสอนเสริมหลังเลิกเรียนสัปดาห์ละ 2 วัน และประสานทุนอาหารกลางวัน นักเรียนมาเรียนสม่ำเสมอขึ้น',
            'มอบทุนการศึกษาฉุกเฉินและอุปกรณ์การเรียน ครูประจำชั้นโทรติดตามผู้ปกครองทุกสัปดาห์ นักเรียนมาเรียนครบทุกวัน'], 'as' || c.id);
          INSERT INTO task_submissions (task_link_id, submitted_at, address_changed, created_at, updated_at, case_follow_up_decision,
                                        assisted_at, assistance_detail, task_execution_outcome_code)
          VALUES (v_link.id, ts, false, ts, ts, 'REQUEST_REVIEW', ts - interval '2 hours', v_summary, 'SUCCEEDED');
        ELSE
          v_reason := causes[1 + pg_temp.h('cause' || c.id) % 8][1];
          v_cat := causes[1 + pg_temp.h('cause' || c.id) % 8][2];
          v_fup := causes[1 + pg_temp.h('cause' || c.id) % 8][3];
          v_cause := causes[1 + pg_temp.h('cause' || c.id) % 8][4];
          v_summary := v_cause;
          v_parental := pg_temp.pick(parentals, 'par' || c.id);
          v_guard := pg_temp.pick(guards, 'gu' || c.id);
          v_contact := coalesce((SELECT g.full_name FROM student_guardian g WHERE g.person_uuid = c.person_uuid AND g.deleted_at IS NULL AND nullif(trim(g.full_name), '') IS NOT NULL ORDER BY g.is_primary DESC NULLS LAST, g.id LIMIT 1), 'ผู้ปกครอง/ผู้ดูแล');
          INSERT INTO task_submissions (task_link_id, visit_lat, visit_lng, cause_detail, recommendation, submitted_at, address_changed, created_at, updated_at,
                                        case_follow_up_decision, visited_at, follow_up_problem_category_code, parental_status_code,
                                        task_execution_outcome_code, contact_person_name, contact_channel_code, absence_reason_code, absence_reason_category_code)
          VALUES (v_link.id, c.student_lat::real, c.student_lng::real, v_cause, pg_temp.pick(recs, 'rec' || c.id), ts, false, ts, ts,
                  'REQUEST_REVIEW', ts - interval '90 minutes', v_fup, v_parental, 'SUCCEEDED', v_contact, 'IN_PERSON', v_reason, v_cat)
          RETURNING id INTO v_sub;
          INSERT INTO task_submission_guardian_types (task_submission_id, guardian_type_code, created_at)
          SELECT v_sub, g, ts FROM unnest(string_to_array(v_guard, ',')) g;
          INSERT INTO task_submission_residence_environments (task_submission_id, residence_environment_code, created_at)
          VALUES (v_sub, 'NORMAL', ts);
        END IF;
        UPDATE task_links SET status = 'COMPLETED', updated_at = ts WHERE id = v_link.id;
        UPDATE tasks SET status = 'COMPLETED', updated_at = ts WHERE id = v_link.task_id;
        UPDATE cases SET status = 'PENDING_REVIEW', completion_outcome_code = NULL, result_summary = v_summary, updated_at = ts WHERE id = c.id;
        INSERT INTO notifications (id, recipient_user_id, type_code, title, body, ref_entity, ref_id, seen_at, read_at, created_at, case_id, student_name_snapshot, reason_text, case_status_code)
        SELECT gen_random_uuid(), r.recipient_user_id, 'CASE_STATUS_CHANGED', 'เคสเปลี่ยนสถานะ: รอพิจารณา', c.student_name, 'case', c.id::text,
               ts + interval '2 hours', ts + interval '2 hours', ts, c.id, c.student_name, 'ผลการติดตาม: ' || v_summary, 'PENDING_REVIEW'
        FROM notif_recipients r WHERE r.case_id = c.id;

      ELSIF steps[k] = 'REFER' THEN
        v_ref_id := gen_random_uuid();
        INSERT INTO case_referrals (id, case_review_id, case_id, referral_agency_id, status_code, referred_at, referred_by_user_id, referral_note, created_at, created_by, updated_at, updated_by)
        SELECT v_ref_id,
               (SELECT r.id FROM case_reviews r WHERE r.case_id = c.id AND r.review_action = 'REFER_AGENCY' ORDER BY r.reviewed_at DESC LIMIT 1),
               c.id, a.id, 'REFERRED', ts, cx.director_id, 'ประสาน ' || a.agency_name || ' เพื่อวางแผนช่วยเหลือนักเรียนและครอบครัว', ts, cx.director_id, ts, cx.director_id
        FROM referral_agencies a WHERE a.is_active ORDER BY pg_temp.h('ag' || c.id || a.id) LIMIT 1;
        UPDATE cases SET status = 'AWAITING_REFERRAL_OUTCOME', updated_at = ts, updated_by = cx.director_id WHERE id = c.id;

      ELSIF steps[k] = 'RESULT' THEN
        SELECT r.id, a.agency_name INTO v_ref FROM case_referrals r JOIN referral_agencies a ON a.id = r.referral_agency_id
        WHERE r.case_id = c.id ORDER BY r.referred_at DESC, r.id DESC LIMIT 1;
        IF v_ref.id IS NULL THEN RAISE EXCEPTION 'case % has no referral', c.id; END IF;
        INSERT INTO case_referral_results (case_referral_id, result_note, recorded_at, recorded_by_user_id, action_date)
        VALUES (v_ref.id, v_ref.agency_name || ' ประสานครอบครัวและให้ความช่วยเหลือเรียบร้อย นักเรียนกลับมาเรียนได้ตามปกติ', ts, cx.director_id,
                (ts AT TIME ZONE 'Asia/Bangkok')::date - 1);
        UPDATE case_referrals SET status_code = 'COMPLETED', updated_at = ts, updated_by = cx.director_id WHERE id = v_ref.id;
        UPDATE case_referral_links SET status_code = 'REVOKED', updated_at = ts WHERE case_referral_id = v_ref.id AND status_code = 'ACTIVE';
        UPDATE cases SET status = 'PENDING_REVIEW', updated_at = ts WHERE id = c.id;
        INSERT INTO audit_log (actor_user_id, actor_label, action, target_type, target_id, metadata, ip, created_at, data_origin_code)
        VALUES (cx.director_id, cx.director_username, 'CASE_REFERRAL_RESULT', 'case', c.id::text,
          jsonb_build_object('nextStatus','PENDING_REVIEW','referralId',v_ref.id,'resultCode','SUCCEEDED'), NULL, ts, 'OPERATIONAL');
        INSERT INTO notifications (id, recipient_user_id, type_code, title, body, ref_entity, ref_id, seen_at, read_at, created_at, case_id, student_name_snapshot, reason_text, case_status_code)
        SELECT gen_random_uuid(), r.recipient_user_id, 'CASE_STATUS_CHANGED', 'เคสเปลี่ยนสถานะ: รอพิจารณา', c.student_name, 'case', c.id::text,
               ts + interval '2 hours', ts + interval '2 hours', ts, c.id, c.student_name, 'ผลการติดตาม: รอผลการพิจารณา', 'PENDING_REVIEW'
        FROM notif_recipients r WHERE r.case_id = c.id AND r.recipient_user_id <> cx.director_id;

      ELSIF steps[k] = 'CLOSE' THEN
        v_note := CASE WHEN 'RESULT' = ANY(steps) THEN 'หน่วยงานช่วยเหลือครอบครัวเรียบร้อย นักเรียนกลับมาเรียนแล้ว ปิดเคส'
                       WHEN v_link.task_type = 'ASSIST' THEN 'การช่วยเหลือตามแผนเสร็จสิ้น นักเรียนมาเรียนต่อเนื่อง ปิดเคส'
                       ELSE pg_temp.pick(close_notes, 'cl' || c.id) END;
        v_review := gen_random_uuid();
        INSERT INTO case_reviews (id, case_id, review_action, review_note, reviewed_by, reviewed_at, created_at, updated_at, created_by, updated_by, source_actor_user_id)
        VALUES (v_review, c.id, 'CLOSE', v_note, cx.director_name, ts, ts, ts, cx.director_id, cx.director_id, cx.director_id);
        UPDATE cases SET status = 'RESOLVED', completion_outcome_code = 'CLOSED', updated_at = ts, updated_by = cx.director_id WHERE id = c.id;
        INSERT INTO audit_log (actor_user_id, actor_label, action, target_type, target_id, metadata, ip, created_at, data_origin_code)
        VALUES (cx.director_id, cx.director_username, 'CASE_CLOSE', 'case', c.id::text,
          jsonb_build_object('reviewAction','CLOSE','referralAgencyId',NULL,'completionOutcome','CLOSED','resolutionOutcome',NULL,'targetWorkflowPhase',NULL,'proposedAssistanceMeasureCodes','[]'::jsonb), NULL, ts, 'OPERATIONAL');
        INSERT INTO notifications (id, recipient_user_id, type_code, title, body, ref_entity, ref_id, seen_at, read_at, created_at, case_id, student_name_snapshot, reason_text, case_status_code)
        SELECT gen_random_uuid(), r.recipient_user_id, 'CASE_STATUS_CHANGED', 'เคสเปลี่ยนสถานะ: เสร็จสิ้น', c.student_name, 'case', c.id::text,
               ts + interval '2 hours', ts + interval '2 hours', ts, c.id, c.student_name, 'ผลการพิจารณา: ' || v_note, 'RESOLVED'
        FROM notif_recipients r WHERE r.case_id = c.id AND r.recipient_user_id <> cx.director_id;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Assignments left open on closed cases (older rounds) end with the case.
UPDATE task_links l SET status = 'CANCELLED', cancelled_at = c.updated_at, cancelled_by = (SELECT director_id FROM ctx),
       cancel_reason = 'ปิดเคสแล้ว', updated_at = c.updated_at
FROM tasks t JOIN cases c ON c.id = t.case_id
WHERE l.task_id = t.id AND l.status = 'ACTIVE' AND c.id IN (SELECT id FROM close_cases);
UPDATE tasks t SET status = 'CANCELLED', updated_at = c.updated_at
FROM cases c WHERE c.id = t.case_id AND t.status IN ('OPEN','ACTIVE','IN_PROGRESS','PENDING_REVIEW') AND c.id IN (SELECT id FROM close_cases);

-- 2. Current students and their reset point --------------------------------
CREATE TEMP TABLE cur ON COMMIT DROP AS
SELECT s.student_uuid, s.person_uuid, s.classroom_id
FROM student_term s
JOIN student_current_enrollment_resolution r ON r.person_uuid = s.person_uuid AND r.selected_student_uuid = s.student_uuid AND r.resolution_state = 'ACTIVE'
WHERE s."SchoolID_Onec" = (SELECT school_id FROM ctx) AND s.deleted_at IS NULL;

CREATE TEMP TABLE baseline ON COMMIT DROP AS
SELECT cur.student_uuid, cur.person_uuid, cur.classroom_id,
  (SELECT max(coalesce((SELECT max(r.reviewed_at) FROM case_reviews r WHERE r.case_id = c.id), c.updated_at))
   FROM cases c WHERE c.person_uuid = cur.person_uuid AND c.status = 'RESOLVED' AND c.deleted_at IS NULL) AS reset_at
FROM cur;

-- Watchlist: the director closes every open watch after the latest comment.
CREATE TEMP TABLE watch_close ON COMMIT DROP AS
SELECT b.student_uuid, max(cm.created_at) AS last_comment
FROM baseline b JOIN classroom_student_comments cm ON cm.person_uuid = b.person_uuid
WHERE cm.created_at > greatest(coalesce(b.reset_at, '-infinity'),
        coalesce((SELECT max(w.closed_at) FROM student_watch_closures w JOIN student_term s2 ON s2.student_uuid = w.student_uuid WHERE s2.person_uuid = b.person_uuid), '-infinity'))
GROUP BY b.student_uuid;

WITH ins AS (
  INSERT INTO student_watch_closures (student_uuid, note, closed_by_user_id, closed_at)
  SELECT w.student_uuid,
         pg_temp.pick(ARRAY['ครูประจำชั้นพูดคุยกับนักเรียนและผู้ปกครองแล้ว นักเรียนปรับตัวได้ดี มาเรียนปกติ',
                            'ติดตามต่อเนื่อง 2 สัปดาห์ ไม่พบพฤติกรรมน่ากังวลเพิ่มเติม',
                            'ผู้ปกครองรับทราบและช่วยดูแลที่บ้าน นักเรียนร่วมกิจกรรมในห้องได้ดีขึ้น'], 'w' || w.student_uuid),
         (SELECT director_id FROM ctx),
         least(pg_temp.bkk((w.last_comment AT TIME ZONE 'Asia/Bangkok')::date + 1 + pg_temp.h('wd' || w.student_uuid) % 2, 14, pg_temp.h('wm' || w.student_uuid) % 60),
               pg_temp.bkk(DATE '2026-10-12', 16, 0))
  FROM watch_close w
  RETURNING id, student_uuid, closed_at)
INSERT INTO audit_log (actor_user_id, actor_label, action, target_type, target_id, metadata, ip, created_at, data_origin_code)
SELECT (SELECT director_id FROM ctx), (SELECT director_username FROM ctx), 'WATCH_CLOSE', 'student', ins.student_uuid::text,
       jsonb_build_object('scope', (SELECT scope FROM ctx), 'schoolId', (SELECT school_id FROM ctx), 'closureId', ins.id), NULL, ins.closed_at, 'OPERATIONAL'
FROM ins;

-- 3. Attendance --------------------------------------------------------------
CREATE TEMP TABLE school_days ON COMMIT DROP AS
SELECT d::date AS day FROM generate_series(DATE '2026-08-11', DATE '2026-10-15', interval '1 day') d
WHERE extract(isodow FROM d) <= 5 AND d::date NOT IN (DATE '2026-08-12', DATE '2026-10-13');

CREATE TEMP TABLE live_sessions ON COMMIT DROP AS
SELECT s.* FROM attendance_sessions s
WHERE s.school_id = (SELECT school_id FROM ctx) AND s.school_term_id = (SELECT term_id FROM ctx)
  AND s.deleted_at IS NULL AND s.status IN ('SUBMITTED','REOPENED') AND s.record_storage_mode = 'EXCEPTIONS' AND s.session_kind = 'SUBJECT';

-- Each classroom's timetable per weekday = its fullest recorded day of that weekday.
CREATE TEMP TABLE template_day ON COMMIT DROP AS
SELECT DISTINCT ON (classroom_id, dow) classroom_id, dow, attendance_date
FROM (SELECT classroom_id, extract(isodow FROM attendance_date)::int AS dow, attendance_date, count(*) AS n
      FROM live_sessions GROUP BY 1, 2, 3) x
ORDER BY classroom_id, dow, n DESC, attendance_date DESC;

CREATE TEMP TABLE new_sessions ON COMMIT DROP AS
SELECT gen_random_uuid() AS id, t.school_term_id, t.school_id, t.grade_level_id, t.room_id, t.period, t.submitted_by,
       t.created_by, t.updated_by, t.classroom_id, t.classroom_subject_id, t.started_by_teacher_membership_id,
       t.submitted_by_teacher_membership_id, t.classroom_attendance_link_id, d.day,
       pg_temp.bkk(d.day, 0, 0) + ((t.checking_started_at AT TIME ZONE 'Asia/Bangkok')::time - time '00:00') AS new_started,
       pg_temp.bkk(d.day, 0, 0) + ((coalesce(t.submitted_at, t.checking_started_at) AT TIME ZONE 'Asia/Bangkok')::time - time '00:00') AS new_submitted
FROM school_days d
JOIN template_day td ON td.dow = extract(isodow FROM d.day)::int
JOIN live_sessions t ON t.classroom_id = td.classroom_id AND t.attendance_date = td.attendance_date
WHERE NOT EXISTS (SELECT 1 FROM live_sessions x WHERE x.classroom_id = td.classroom_id AND x.attendance_date = d.day);

INSERT INTO attendance_sessions (id, school_term_id, school_id, grade_level_id, room_id, attendance_date, period, session_kind, status,
  expected_roster_count, recorded_count, submitted_at, submitted_by, created_at, created_by, updated_at, updated_by, classroom_id,
  classroom_subject_id, checking_started_at, exception_count, record_storage_mode, started_by_teacher_membership_id,
  submitted_by_teacher_membership_id, classroom_attendance_link_id, submission_number, lock_version)
SELECT id, school_term_id, school_id, grade_level_id, room_id, day, period, 'SUBJECT', 'SUBMITTED',
  0, 0, new_submitted, submitted_by, new_started, created_by, new_submitted, updated_by, classroom_id,
  classroom_subject_id, new_started, 0, 'EXCEPTIONS', started_by_teacher_membership_id,
  submitted_by_teacher_membership_id, classroom_attendance_link_id, 1, 1
FROM new_sessions;

-- Roster: the classroom's current students (also fills students missing from older rounds).
INSERT INTO attendance_session_roster (session_id, student_uuid, created_at, created_by, updated_at, school_id)
SELECT s.id, c.student_uuid, s.checking_started_at, s.created_by, s.checking_started_at, s.school_id
FROM attendance_sessions s JOIN cur c ON c.classroom_id = s.classroom_id
WHERE s.school_id = (SELECT school_id FROM ctx) AND s.school_term_id = (SELECT term_id FROM ctx) AND s.deleted_at IS NULL
  AND s.attendance_date >= DATE '2026-08-11'
ON CONFLICT (session_id, student_uuid) DO NOTHING;

CREATE TEMP TABLE all_sessions ON COMMIT DROP AS
SELECT s.* FROM attendance_sessions s
WHERE s.school_id = (SELECT school_id FROM ctx) AND s.school_term_id = (SELECT term_id FROM ctx)
  AND s.deleted_at IS NULL AND s.status IN ('SUBMITTED','REOPENED') AND s.record_storage_mode = 'EXCEPTIONS' AND s.session_kind = 'SUBJECT';

-- Remove absences after each student's reset point; older ones stay as the
-- history behind the closed cases.
UPDATE attendance_exceptions e SET deleted_at = now(), updated_at = now()
FROM all_sessions s, baseline b
WHERE e.session_id = s.id AND e.student_uuid = b.student_uuid AND e.deleted_at IS NULL AND e.attendance_status_code = 2
  AND s.attendance_date > coalesce((b.reset_at AT TIME ZONE 'Asia/Bangkok')::date, DATE '1900-01-01');

-- Two whole-day absences per student after their reset point, preferring days
-- with no late/leave mark.
CREATE TEMP TABLE absent_days ON COMMIT DROP AS
SELECT student_uuid, day FROM (
  SELECT b.student_uuid, s.attendance_date AS day,
         row_number() OVER (PARTITION BY b.student_uuid ORDER BY
           bool_or(EXISTS (SELECT 1 FROM attendance_exceptions e WHERE e.session_id = s.id AND e.student_uuid = b.student_uuid
                           AND e.deleted_at IS NULL AND e.attendance_status_code IN (3, 4))),
           pg_temp.h('abs' || b.student_uuid || s.attendance_date)) AS rn
  FROM baseline b
  JOIN all_sessions s ON s.classroom_id = b.classroom_id
  JOIN attendance_session_roster r ON r.session_id = s.id AND r.student_uuid = b.student_uuid
  WHERE s.attendance_date > coalesce((b.reset_at AT TIME ZONE 'Asia/Bangkok')::date, DATE '1900-01-01')
    AND s.attendance_date <= DATE '2026-10-15'
  GROUP BY b.student_uuid, s.attendance_date
) x WHERE rn <= 2;

-- A little ordinary noise on the new days: late arrivals and the odd sick leave.
INSERT INTO attendance_exceptions (session_id, student_uuid, attendance_status_code, marked_at, marked_by_teacher_membership_id, created_at, updated_at, school_id)
SELECT s.id, r.student_uuid, 3, s.checking_started_at + interval '12 minutes', s.submitted_by_teacher_membership_id,
       s.checking_started_at + interval '12 minutes', s.checking_started_at + interval '12 minutes', s.school_id
FROM new_sessions ns JOIN attendance_sessions s ON s.id = ns.id
JOIN attendance_session_roster r ON r.session_id = s.id
WHERE pg_temp.h('late' || s.id || r.student_uuid) % 100 < 2
  AND NOT EXISTS (SELECT 1 FROM absent_days a WHERE a.student_uuid = r.student_uuid AND a.day = s.attendance_date)
ON CONFLICT (session_id, student_uuid) DO NOTHING;

INSERT INTO attendance_exceptions (session_id, student_uuid, attendance_status_code, marked_at, marked_by_teacher_membership_id, created_at, updated_at, school_id)
SELECT s.id, r.student_uuid, 4, s.checking_started_at + interval '3 minutes', s.submitted_by_teacher_membership_id,
       s.checking_started_at + interval '3 minutes', s.checking_started_at + interval '3 minutes', s.school_id
FROM new_sessions ns JOIN attendance_sessions s ON s.id = ns.id
JOIN attendance_session_roster r ON r.session_id = s.id
WHERE pg_temp.h('leave' || s.attendance_date || r.student_uuid) % 1000 < 6
  AND NOT EXISTS (SELECT 1 FROM absent_days a WHERE a.student_uuid = r.student_uuid AND a.day = s.attendance_date)
ON CONFLICT (session_id, student_uuid) DO UPDATE SET attendance_status_code = 4;

INSERT INTO attendance_exceptions (session_id, student_uuid, attendance_status_code, marked_at, marked_by_teacher_membership_id, created_at, updated_at, school_id)
SELECT s.id, a.student_uuid, 2, s.checking_started_at + interval '5 minutes', s.submitted_by_teacher_membership_id,
       s.checking_started_at + interval '5 minutes', s.checking_started_at + interval '5 minutes', s.school_id
FROM absent_days a
JOIN baseline b ON b.student_uuid = a.student_uuid
JOIN all_sessions s ON s.classroom_id = b.classroom_id AND s.attendance_date = a.day
JOIN attendance_session_roster r ON r.session_id = s.id AND r.student_uuid = a.student_uuid
ON CONFLICT (session_id, student_uuid) DO UPDATE
SET attendance_status_code = 2, deleted_at = NULL, deleted_by = NULL, marked_at = EXCLUDED.marked_at,
    marked_by_teacher_membership_id = EXCLUDED.marked_by_teacher_membership_id, updated_at = EXCLUDED.updated_at;

-- Session counters + submission history for the new rounds.
UPDATE attendance_sessions s SET
  expected_roster_count = (SELECT count(*) FROM attendance_session_roster r WHERE r.session_id = s.id AND r.deleted_at IS NULL),
  recorded_count = (SELECT count(*) FROM attendance_session_roster r WHERE r.session_id = s.id AND r.deleted_at IS NULL),
  exception_count = (SELECT count(*) FROM attendance_exceptions e WHERE e.session_id = s.id AND e.deleted_at IS NULL)
WHERE s.id IN (SELECT id FROM all_sessions);

-- Each classroom's rounds are checked by its homeroom teacher.
WITH room_homeroom AS (
  SELECT DISTINCT ON (a.classroom_id) a.classroom_id, a.teacher_membership_id
  FROM classroom_homeroom_teacher_assignments a
  ORDER BY a.classroom_id, a.is_primary DESC
)
UPDATE attendance_sessions s
SET started_by_teacher_membership_id = h.teacher_membership_id,
    submitted_by_teacher_membership_id = h.teacher_membership_id
FROM room_homeroom h
WHERE s.classroom_id = h.classroom_id AND s.school_id = (SELECT school_id FROM ctx)
  AND s.school_term_id = (SELECT term_id FROM ctx) AND s.deleted_at IS NULL;
UPDATE attendance_exceptions e SET marked_by_teacher_membership_id = s.submitted_by_teacher_membership_id
FROM attendance_sessions s
WHERE e.session_id = s.id AND s.school_id = (SELECT school_id FROM ctx) AND s.school_term_id = (SELECT term_id FROM ctx)
  AND e.marked_by_teacher_membership_id IS DISTINCT FROM s.submitted_by_teacher_membership_id;

INSERT INTO attendance_submission_history (session_id, school_id, submission_number, actor_user_id, actor_teacher_membership_id, source,
  classroom_attendance_link_id, submitted_at, expected_roster_count, exception_count, created_at)
SELECT s.id, s.school_id, 1, s.submitted_by, s.submitted_by_teacher_membership_id,
       CASE WHEN s.classroom_attendance_link_id IS NOT NULL THEN 'CLASSROOM_LINK' ELSE 'INTERNAL' END,
       s.classroom_attendance_link_id, s.submitted_at, s.expected_roster_count, s.exception_count, s.submitted_at
FROM attendance_sessions s WHERE s.id IN (SELECT id FROM new_sessions);

ALTER TABLE cases ENABLE TRIGGER trg_cases_set_updated_at;
ALTER TABLE case_reviews ENABLE TRIGGER trg_case_reviews_set_updated_at;
ALTER TABLE tasks ENABLE TRIGGER trg_tasks_set_updated_at;
ALTER TABLE task_links ENABLE TRIGGER trg_task_links_set_updated_at;
ALTER TABLE task_submissions ENABLE TRIGGER trg_task_submissions_set_updated_at;
ALTER TABLE attendance_sessions ENABLE TRIGGER trg_attendance_sessions_set_updated_at;
ALTER TABLE attendance_exceptions ENABLE TRIGGER trg_attendance_exceptions_set_updated_at;

-- Risk profiles are recalculated by the backend's startup repair, which
-- rebuilds every active enrollment that has no profile row.
DELETE FROM student_risk_profiles WHERE school_id = (SELECT school_id FROM ctx);
`;
