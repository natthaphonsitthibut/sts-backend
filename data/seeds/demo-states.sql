-- Demo activity covering every link lifecycle state, for presentations.
-- Idempotent: removes its own rows first, then re-inserts. Run against a DB that
-- already has the baseline seed (users/schools/roles). Actor FKs resolve by
-- stable demo usernames instead of environment-specific numeric user IDs.
-- States covered across the 3 link types:
--   VISIT       : case-without-link (cases 1001/1006), active (1002),
--                 completed (1003), pending-review (1004), expired (new 1005)
--   ATTENDANCE  : checked (existing 1/2 with records), fresh/no-records (new 3)
--   LOGIN       : used (new login-1), admin-locked/unopened (new login-2)

BEGIN;

-- Clean any prior run by both current UUID and stable token hash. Older
-- backups used different deterministic UUIDs for the same demo links.
CREATE TEMP TABLE demo_state_task_cleanup_20260724 (
  task_id UUID PRIMARY KEY
) ON COMMIT DROP;

INSERT INTO demo_state_task_cleanup_20260724 (task_id)
SELECT DISTINCT task_id
FROM task_links
WHERE id IN (
  '5b32ebc9-56e5-4b8f-b8e5-d01598943118', 'd5578f4a-9aa9-4c41-b820-66fefb0a71d5',
  'f863b2af-ef2d-4069-aeb3-14d9a8898dc7', '13fe00ea-a462-4ed3-9db6-2f3f97be806c'
)
OR token_hash IN (
  '1491e917687e944a0cf35525131219dda75cc140f73c3f89a4bced1967669b87',
  '97ebdfc85682e6c465f6aafdeacece83c7153c95b152e08bce811c0c7e69bd0f',
  '620320ee74dcdb448c4c1df57674787a7b24d26d3d907a5cfb0ae6a6257b907b',
  'a49699205212c4615d9aa40b1f7044edb1793fe6ecdbed6241b9cd836a4132ba'
)
ON CONFLICT (task_id) DO NOTHING;

DELETE FROM task_submissions
WHERE task_link_id IN (
  SELECT id
  FROM task_links
  WHERE task_id IN (SELECT task_id FROM demo_state_task_cleanup_20260724)
);
DELETE FROM task_links
WHERE task_id IN (SELECT task_id FROM demo_state_task_cleanup_20260724);
DELETE FROM tasks
WHERE (
  id IN (SELECT task_id FROM demo_state_task_cleanup_20260724)
  OR id IN (
    'e4e70ad7-50de-4d2c-bf30-71b4c6d7766c', '1f1f8d88-3317-4c75-a64b-1142ea318725',
    '0f2776f2-a492-44c3-84a9-f49a4a3c93dd', 'd90d491c-dc50-493c-99f9-ea93876af8b1'
  )
)
AND NOT EXISTS (SELECT 1 FROM task_links link WHERE link.task_id = tasks.id);

-- VISIT — expired link (case 1005 already exists, AWAITING_HELP).
INSERT INTO tasks (id, case_id, status, task_type, created_at, updated_at, created_by, updated_by)
VALUES ('e4e70ad7-50de-4d2c-bf30-71b4c6d7766c', 1005, 'ACTIVE', 'VISIT',
        '2026-05-20 03:00:00+00', '2026-05-20 03:00:00+00',
        (SELECT id FROM users WHERE username = 'orathai.b' AND data_origin_code = 'DEMO'),
        (SELECT id FROM users WHERE username = 'orathai.b' AND data_origin_code = 'DEMO'));
INSERT INTO task_links
  (id, task_id, token_hash, magic_link, delegation_depth, assigned_to_name,
   assigned_to_phone, assigned_to_email, otp_verified, subject, status,
   admin_locked, expires_at, created_at, updated_at, created_by,
   login_permissions, login_data_scope)
VALUES
  ('5b32ebc9-56e5-4b8f-b8e5-d01598943118', 'e4e70ad7-50de-4d2c-bf30-71b4c6d7766c', '1491e917687e944a0cf35525131219dda75cc140f73c3f89a4bced1967669b87', '/task/cd9c99fbe4d761679395deb7b47950ff358f72190a722c87115d87738ba6b0f9', 0,
   'ชาญวิทย์ ใจมั่น', '0800000009', 'chanwit.j@sts-demo.ac.th', 0,
   'ลงพื้นที่ติดตามนักเรียน', 'ACTIVE', 0,
   '2026-05-27 03:00:00+00', '2026-05-20 03:00:00+00', '2026-05-20 03:00:00+00',
   (SELECT id FROM users WHERE username = 'orathai.b' AND data_origin_code = 'DEMO'),
   '[]'::jsonb, '{}'::jsonb);

-- ATTENDANCE — fresh link, no attendance records yet.
INSERT INTO tasks (id, case_id, status, task_type, target_grade, target_room, target_school_id,
                   created_at, updated_at, created_by, updated_by)
VALUES ('1f1f8d88-3317-4c75-a64b-1142ea318725', NULL, 'ACTIVE', 'ATTENDANCE', 'ป.6', '1', 10010002,
        '2026-06-13 02:00:00+00', '2026-06-13 02:00:00+00',
        (SELECT id FROM users WHERE username = 'narongsak.k' AND data_origin_code = 'DEMO'),
        (SELECT id FROM users WHERE username = 'narongsak.k' AND data_origin_code = 'DEMO'));
INSERT INTO task_links
  (id, task_id, token_hash, magic_link, delegation_depth, assigned_to_name,
   assigned_to_phone, assigned_to_email, otp_verified, subject, status,
   admin_locked, expires_at, created_at, updated_at, created_by,
   login_permissions, login_data_scope)
VALUES
  ('d5578f4a-9aa9-4c41-b820-66fefb0a71d5', '1f1f8d88-3317-4c75-a64b-1142ea318725', '97ebdfc85682e6c465f6aafdeacece83c7153c95b152e08bce811c0c7e69bd0f',
   '/task/52851e14b4c4f7a569fe5056e08dc1fd34c6591d3b8496f8ee23fd53aaa948fe', 0, 'ณรงค์ศักดิ์ แก้วมณี', '0800000010',
   'narongsak.k@sts-demo.ac.th', 0, 'เช็คชื่อ ป.6 ห้อง 1', 'ACTIVE', 0,
   '2026-06-20 02:00:00+00', '2026-06-13 02:00:00+00', '2026-06-13 02:00:00+00',
   (SELECT id FROM users WHERE username = 'narongsak.k' AND data_origin_code = 'DEMO'),
   '[]'::jsonb, '{}'::jsonb);

-- LOGIN — successfully used magic-login link (TEACHER).
INSERT INTO tasks (id, case_id, status, task_type, created_at, updated_at, created_by, updated_by)
VALUES ('0f2776f2-a492-44c3-84a9-f49a4a3c93dd', NULL, 'ACTIVE', 'LOGIN',
        '2026-06-12 04:00:00+00', '2026-06-12 04:00:00+00',
        (SELECT id FROM users WHERE username = 'orathai.b' AND data_origin_code = 'DEMO'),
        (SELECT id FROM users WHERE username = 'orathai.b' AND data_origin_code = 'DEMO'));
INSERT INTO task_links
  (id, task_id, token_hash, magic_link, delegation_depth, assigned_to_name,
   assigned_to_email, otp_verified, subject, status, admin_locked, expires_at,
   created_at, updated_at, created_by, first_used_at, login_role, login_permissions,
   login_data_scope)
VALUES
  ('f863b2af-ef2d-4069-aeb3-14d9a8898dc7', '0f2776f2-a492-44c3-84a9-f49a4a3c93dd', '620320ee74dcdb448c4c1df57674787a7b24d26d3d907a5cfb0ae6a6257b907b', '/task/6e641b6f0595b5f2fb02b55fc9982ca5e9220e8c13fe54ffa658bc1bd36698bc', 0,
   'สุภาวดี วัฒนานุกูล', 'suphawadi.w@sts-demo.ac.th', 0,
   'ลิงก์เข้าสู่ระบบสำหรับครู', 'ACTIVE', 0, '2026-06-19 04:00:00+00',
   '2026-06-12 04:00:00+00', '2026-06-12 04:00:00+00',
   (SELECT id FROM users WHERE username = 'orathai.b' AND data_origin_code = 'DEMO'),
   '2026-06-12 04:15:00+00', 'TEACHER',
   '["home", "attendance", "students", "create"]'::jsonb,
   '{"school_ids": [10010002], "own_only": false}'::jsonb);

-- LOGIN — admin-locked magic-login link.
INSERT INTO tasks (id, case_id, status, task_type, created_at, updated_at, created_by, updated_by)
VALUES ('d90d491c-dc50-493c-99f9-ea93876af8b1', NULL, 'ACTIVE', 'LOGIN',
        '2026-06-12 05:00:00+00', '2026-06-12 06:00:00+00',
        (SELECT id FROM users WHERE username = 'orathai.b' AND data_origin_code = 'DEMO'),
        (SELECT id FROM users WHERE username = 'orathai.b' AND data_origin_code = 'DEMO'));
INSERT INTO task_links
  (id, task_id, token_hash, magic_link, delegation_depth, assigned_to_name,
   assigned_to_email, otp_verified, subject, status, admin_locked, admin_lock_reason,
   admin_lock_at, expires_at, created_at, updated_at, created_by, login_role,
   login_permissions, login_data_scope)
VALUES
  ('13fe00ea-a462-4ed3-9db6-2f3f97be806c', 'd90d491c-dc50-493c-99f9-ea93876af8b1', 'a49699205212c4615d9aa40b1f7044edb1793fe6ecdbed6241b9cd836a4132ba', '/task/b78cd3a7b8de14078f446a822f3143619e3e639580403b9eef26f6410c932421', 0,
   'ปรียา ศรีประเสริฐ', 'preeya.p@sts-demo.ac.th', 0,
   'ลิงก์เข้าสู่ระบบสำหรับผู้บริหาร', 'ACTIVE', 1, 'ปิดลิงก์โดยผู้ดูแลระบบ',
   '2026-06-12 06:00:00+00', '2026-06-19 05:00:00+00', '2026-06-12 05:00:00+00',
   '2026-06-12 06:00:00+00',
   (SELECT id FROM users WHERE username = 'orathai.b' AND data_origin_code = 'DEMO'),
   'ADMIN',
   '["home", "attendance", "attendance-dashboard", "students"]'::jsonb,
   '{"school_ids": [10010002], "own_only": false}'::jsonb);

COMMIT;
