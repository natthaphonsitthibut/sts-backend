-- Demo "ผู้สมัคร อสม" (field follower) applications — realistic Thai names,
-- phone numbers, and sub-district/district/province matching the same real
-- Mueang Chiang Mai area already used by the demo cases (school 10010002),
-- covering every status the review page handles (APPLIED/VERIFIED/ACTIVE/
-- SUSPENDED) with reviewer references to real admin demo accounts.
-- Idempotent: delete-then-insert keyed by this script's fixed phone numbers.
-- Run against a DB that already has the baseline seed (users/schools).

BEGIN;

DELETE FROM field_followers WHERE phone IN (
  '0891234567', '0856781234', '0923456781', '0812349876',
  '0812345678', '0834567890', '0847891234'
);

INSERT INTO field_followers
  (first_name, last_name, phone, sub_district, district, province, status,
   trust_level, applied_via, reviewed_by_user_id, reviewed_at, created_at, updated_at)
VALUES
  ('อรุณี', 'แสงทอง', '0891234567', 'สุเทพ', 'เมืองเชียงใหม่', 'เชียงใหม่',
   'APPLIED', 'STANDARD', 'PUBLIC_FORM', NULL, NULL,
   '2026-07-06 03:10:00+00', '2026-07-06 03:10:00+00'),

  ('ประเสริฐ', 'บุญมี', '0856781234', 'ศรีภูมิ', 'เมืองเชียงใหม่', 'เชียงใหม่',
   'APPLIED', 'STANDARD', 'PUBLIC_FORM', NULL, NULL,
   '2026-07-07 08:45:00+00', '2026-07-07 08:45:00+00'),

  ('กัลยา', 'ศรีสุข', '0847891234', 'สุเทพ', 'เมืองเชียงใหม่', 'เชียงใหม่',
   'APPLIED', 'STANDARD', 'PUBLIC_FORM', NULL, NULL,
   '2026-07-07 12:20:00+00', '2026-07-07 12:20:00+00'),

  ('มาลี', 'ปัญญาดี', '0923456781', 'หายยา', 'เมืองเชียงใหม่', 'เชียงใหม่',
   'VERIFIED', 'STANDARD', 'PUBLIC_FORM',
   (SELECT id FROM users WHERE username = 'worapon.d' AND data_origin_code = 'DEMO'),
   '2026-06-22 06:00:00+00',
   '2026-06-19 02:30:00+00', '2026-06-22 06:00:00+00'),

  ('สมชาย', 'ใจดี', '0812349876', 'พระสิงห์', 'เมืองเชียงใหม่', 'เชียงใหม่',
   'VERIFIED', 'STANDARD', 'PUBLIC_FORM',
   (SELECT id FROM users WHERE username = 'phatcharin.d' AND data_origin_code = 'DEMO'),
   '2026-06-28 07:15:00+00',
   '2026-06-25 01:50:00+00', '2026-06-28 07:15:00+00'),

  ('ศิริพร', 'พัฒนกิจ', '0812345678', 'ศรีภูมิ', 'เมืองเชียงใหม่', 'เชียงใหม่',
   'ACTIVE', 'STANDARD', 'PUBLIC_FORM',
   (SELECT id FROM users WHERE username = 'worapon.d' AND data_origin_code = 'DEMO'),
   '2026-06-18 04:00:00+00',
   '2026-06-15 02:00:00+00', '2026-06-18 04:00:00+00'),

  ('วิชัย', 'ตั้งมั่นคง', '0834567890', 'ช้างมอย', 'เมืองเชียงใหม่', 'เชียงใหม่',
   'SUSPENDED', 'STANDARD', 'PUBLIC_FORM',
   (SELECT id FROM users WHERE username = 'worapon.d' AND data_origin_code = 'DEMO'),
   '2026-07-02 09:30:00+00',
   '2026-06-10 03:00:00+00', '2026-07-02 09:30:00+00');

COMMIT;
