-- Demo activity covering every link lifecycle state, for presentations.
-- Idempotent: removes its own rows first, then re-inserts. Run against a DB that
-- already has the baseline seed (users/schools/roles). created_by = seed_admin(5).
-- States covered across the 3 link types:
--   VISIT       : case-without-link (cases 1001/1006), active (1002),
--                 completed (1003), pending-review (1004), expired (new 1005)
--   ATTENDANCE  : checked (existing 1/2 with records), fresh/no-records (new 3)
--   LOGIN       : active (new login-1), admin-locked (new login-2)

BEGIN;

-- Clean any prior run of these demo rows (children first).
DELETE FROM task_links WHERE id IN (
  'seed-link-1005', 'seed-link-attendance-3', 'seed-link-login-1', 'seed-link-login-2'
);
DELETE FROM tasks WHERE id IN (
  'seed-task-1005', 'seed-attendance-task-3', 'seed-task-login-1', 'seed-task-login-2'
);

-- VISIT — expired link (case 1005 already exists, AWAITING_HELP).
INSERT INTO tasks (id, case_id, status, task_type, created_at, updated_at, created_by, updated_by)
VALUES ('seed-task-1005', 1005, 'ACTIVE', 'VISIT',
        '2026-05-20 03:00:00+00', '2026-05-20 03:00:00+00', 5, 5);
INSERT INTO task_links
  (id, task_id, token_hash, magic_link, delegation_depth, assigned_to_name,
   assigned_to_phone, assigned_to_email, otp_verified, subject, status,
   admin_locked, expires_at, created_at, updated_at, created_by,
   login_permissions, login_data_scope)
VALUES
  ('seed-link-1005', 'seed-task-1005', 'seed-token-hash-1005', '/task/seed-visit-1005', 0,
   'ครูชาญวิทย์ ครูประจำชั้น', '0800000009', 'seed.teacher.p6r2@example.test', 0,
   'ลงพื้นที่ติดตามนักเรียน (หมดอายุ)', 'ACTIVE', 0,
   '2026-05-27 03:00:00+00', '2026-05-20 03:00:00+00', '2026-05-20 03:00:00+00', 5,
   '[]'::jsonb, '{}'::jsonb);

-- ATTENDANCE — fresh link, no attendance records yet.
INSERT INTO tasks (id, case_id, status, task_type, target_grade, target_room, target_school_id,
                   created_at, updated_at, created_by, updated_by)
VALUES ('seed-attendance-task-3', NULL, 'ACTIVE', 'ATTENDANCE', 'ป.6', '1', 10010002,
        '2026-06-13 02:00:00+00', '2026-06-13 02:00:00+00', 14, 14);
INSERT INTO task_links
  (id, task_id, token_hash, magic_link, delegation_depth, assigned_to_name,
   assigned_to_phone, assigned_to_email, otp_verified, subject, status,
   admin_locked, expires_at, created_at, updated_at, created_by,
   login_permissions, login_data_scope)
VALUES
  ('seed-link-attendance-3', 'seed-attendance-task-3', 'seed-token-hash-attendance-3',
   '/attendance/seed-p6-room1', 0, 'ครูวีรพล ครูประจำชั้น', '0800000010',
   'seed.teacher.ud.p6r1@example.test', 0, 'เช็คชื่อ ป.6 ห้อง 1', 'ACTIVE', 0,
   '2026-06-20 02:00:00+00', '2026-06-13 02:00:00+00', '2026-06-13 02:00:00+00', 14,
   '[]'::jsonb, '{}'::jsonb);

-- LOGIN — active magic-login link (TEACHER).
INSERT INTO tasks (id, case_id, status, task_type, created_at, updated_at, created_by, updated_by)
VALUES ('seed-task-login-1', NULL, 'ACTIVE', 'LOGIN',
        '2026-06-12 04:00:00+00', '2026-06-12 04:00:00+00', 5, 5);
INSERT INTO task_links
  (id, task_id, token_hash, magic_link, delegation_depth, assigned_to_name,
   assigned_to_email, otp_verified, subject, status, admin_locked, expires_at,
   created_at, updated_at, created_by, login_role, login_permissions, login_data_scope)
VALUES
  ('seed-link-login-1', 'seed-task-login-1', 'seed-token-hash-login-1', '/task/seed-login-1', 0,
   'ครูสุภาวดี ครูประจำชั้น', 'seed.teacher.p3r1@example.test', 0,
   'ลิงก์เข้าสู่ระบบสำหรับครู', 'ACTIVE', 0, '2026-06-19 04:00:00+00',
   '2026-06-12 04:00:00+00', '2026-06-12 04:00:00+00', 5, 'TEACHER',
   '["home", "attendance", "students", "create"]'::jsonb,
   '{"school_ids": [10010002], "own_only": false}'::jsonb);

-- LOGIN — admin-locked magic-login link.
INSERT INTO tasks (id, case_id, status, task_type, created_at, updated_at, created_by, updated_by)
VALUES ('seed-task-login-2', NULL, 'ACTIVE', 'LOGIN',
        '2026-06-12 05:00:00+00', '2026-06-12 06:00:00+00', 5, 5);
INSERT INTO task_links
  (id, task_id, token_hash, magic_link, delegation_depth, assigned_to_name,
   assigned_to_email, otp_verified, subject, status, admin_locked, admin_lock_reason,
   admin_lock_at, expires_at, created_at, updated_at, created_by, login_role,
   login_permissions, login_data_scope)
VALUES
  ('seed-link-login-2', 'seed-task-login-2', 'seed-token-hash-login-2', '/task/seed-login-2', 0,
   'ผอ.ปรียา ผู้อำนวยการ', 'seed.director@example.test', 0,
   'ลิงก์เข้าสู่ระบบสำหรับผู้บริหาร (ถูกล็อก)', 'ACTIVE', 1, 'ปิดลิงก์โดยผู้ดูแลระบบ',
   '2026-06-12 06:00:00+00', '2026-06-19 05:00:00+00', '2026-06-12 05:00:00+00',
   '2026-06-12 06:00:00+00', 5, 'ADMIN_SCHOOL',
   '["home", "attendance", "attendance-dashboard", "students"]'::jsonb,
   '{"school_ids": [10010002], "own_only": false}'::jsonb);

COMMIT;
