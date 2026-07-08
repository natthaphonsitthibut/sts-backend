-- Pre-production cleanup pass (2026-07-08) — fixes test/junk artifacts found
-- while seeding timetable/field-follower/work-session demo data, so nothing
-- embarrassing surfaces in a client-facing demo. Idempotent: every statement
-- is guarded by a WHERE clause that only matches the specific contaminated
-- value, so re-running this after the fix is already applied is a no-op.
-- Run against a DB that already has the baseline seed.

BEGIN;

-- 1) Two case reviews still show the pre-rename literal username instead of
--    the reviewing director's real display name (case.service.ts normally
--    stores actorName, e.g. "ปรียา ศรีประเสริฐ" — the real DIRECTOR for
--    school 10010002 per seed-users.md).
UPDATE case_reviews
SET reviewed_by = 'ปรียา ศรีประเสริฐ'
WHERE reviewed_by = 'seed_director_10010002';

-- 2) Case 1022 is a leftover browser-smoke fixture (English reason text,
--    Bangkok coordinates on a Chiang-Mai-themed demo map, created/updated by
--    a disabled smoke account) that a real home-visit smoke run left behind
--    with no data_origin_code column to hide it. Soft-delete (not hard
--    delete) per the project's existing "hide, don't delete" convention —
--    every case/risk-map query already filters `deleted_at IS NULL`.
UPDATE cases
SET deleted_at = now(), deleted_by = 1 -- newnew, main admin
WHERE id = 1022 AND deleted_at IS NULL;

-- 3) Two accounts are live (`status = 'ACTIVE'`) with garbage identities
--    (keyboard-mash username with an elevated DIRECTOR role; username
--    literally "test" with an ADMIN role) yet mistagged as OPERATIONAL —
--    every sibling smoke fixture is correctly tagged AUTOMATED_TEST. These
--    are the two rows in this cleanup that matter most: active accounts
--    with real permissions and no legitimate identity behind them. Disable
--    them through the proper account-lifecycle columns and retag.
UPDATE users
SET status = 'DISABLED',
    deactivated_at = now(),
    deactivated_by = 1, -- newnew, main admin
    deactivation_reason_code = 'OTHER',
    deactivation_note = 'บัญชีทดสอบ identity ไม่สมบูรณ์ ปิดก่อนขึ้น production',
    data_origin_code = 'AUTOMATED_TEST',
    updated_at = now(),
    updated_by = 1
WHERE id IN (412, 413) AND status = 'ACTIVE' AND data_origin_code = 'OPERATIONAL';

-- 4) These are already DISABLED smoke fixtures, just mistagged OPERATIONAL —
--    retag only, no status/lifecycle change needed.
UPDATE users
SET data_origin_code = 'AUTOMATED_TEST', updated_at = now(), updated_by = 1
WHERE id IN (19, 20, 452, 455, 460, 461)
  AND status = 'DISABLED'
  AND data_origin_code = 'OPERATIONAL';

-- 5) Of the school's real HIGH/MEDIUM at-risk students (computed by the real
--    risk engine, not test data), 5 have no home coordinate anywhere (no
--    case override, no profile address geocode) so they'd render no pin at
--    all on "แผนที่เด็กเสี่ยง" if a staff member selected them. Backfill a
--    realistic coordinate in their actual sub-district (all real Mueang
--    Chiang Mai sub-districts, same city area as the existing case pins).
UPDATE student_term
SET address_latitude = v.lat, address_longitude = v.lng
FROM (VALUES
  ('0934a2b4-cf59-4cd8-ae95-c0ff900ac6a1'::uuid, 18.7935::double precision, 98.9865::double precision), -- หายยา
  ('824e5132-0498-4e15-a74f-ba4bf9246207'::uuid, 18.7975::double precision, 98.9515::double precision), -- สุเทพ
  ('a48a65e4-bd29-403d-a8e8-701fdef316a0'::uuid, 18.7890::double precision, 98.9840::double precision), -- หายยา
  ('6f61c1b8-a67f-4827-9b46-54ada96cb309'::uuid, 18.8015::double precision, 98.9490::double precision), -- สุเทพ
  ('c7e3f2d5-0bd9-4f45-8a6a-97a5a44c7cf6'::uuid, 18.7920::double precision, 98.9780::double precision)  -- พระสิงห์
) AS v(student_uuid, lat, lng)
WHERE student_term.student_uuid = v.student_uuid
  AND student_term.address_latitude IS NULL;

COMMIT;
