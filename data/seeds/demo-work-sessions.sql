-- Demo "ติดตามช่วงปฏิบัติงาน" (field work-session) history — two completed
-- home-visit sessions attached to the existing curated VISIT task_links
-- (`seed-link-1003`, `seed-link-1006`), each with a short trail of position
-- pings near that case's real home coordinates. Deliberately only historical
-- (ended_at set) — an "open" session in static seed data would look stale/
-- broken the moment a demo runs on a later date, so the monitor's "currently
-- active" view stays legitimately empty while "history" shows real visits.
-- Idempotent: delete-then-insert keyed by the two task_link ids (position
-- pings cascade-delete with their session via FK ON DELETE CASCADE).
-- Run against a DB that already has the baseline seed + `demo-states.sql`.

BEGIN;

DELETE FROM visit_work_sessions WHERE task_link_id IN ('seed-link-1003', 'seed-link-1006');

-- Case 1003 (สรุปผลช่วยเหลือนักเรียน, resolved) — visit near 18.801, 98.958.
WITH session_1003 AS (
  INSERT INTO visit_work_sessions (task_link_id, started_at, ended_at, end_reason, consent_at)
  VALUES ('seed-link-1003', '2026-06-10 09:02:00+00', '2026-06-10 09:38:00+00', 'SUBMITTED', '2026-06-10 09:02:00+00')
  RETURNING id
)
INSERT INTO visit_position_pings (session_id, lat, lng, recorded_at)
SELECT session_1003.id, ping.lat, ping.lng, ping.recorded_at
FROM session_1003
CROSS JOIN (VALUES
  (18.800700::double precision, 98.957600::double precision, TIMESTAMPTZ '2026-06-10 09:03:00+00'),
  (18.800850::double precision, 98.957850::double precision, TIMESTAMPTZ '2026-06-10 09:11:00+00'),
  (18.800950::double precision, 98.958050::double precision, TIMESTAMPTZ '2026-06-10 09:19:00+00'),
  (18.801000::double precision, 98.958000::double precision, TIMESTAMPTZ '2026-06-10 09:27:00+00'),
  (18.800980::double precision, 98.957980::double precision, TIMESTAMPTZ '2026-06-10 09:35:00+00')
) AS ping(lat, lng, recorded_at);

-- Case 1006 (ติดตามนักเรียนเสี่ยงหลุดจากระบบ, pending review) — visit near 18.807, 98.964.
WITH session_1006 AS (
  INSERT INTO visit_work_sessions (task_link_id, started_at, ended_at, end_reason, consent_at)
  VALUES ('seed-link-1006', '2026-07-05 10:05:00+00', '2026-07-05 10:42:00+00', 'SUBMITTED', '2026-07-05 10:05:00+00')
  RETURNING id
)
INSERT INTO visit_position_pings (session_id, lat, lng, recorded_at)
SELECT session_1006.id, ping.lat, ping.lng, ping.recorded_at
FROM session_1006
CROSS JOIN (VALUES
  (18.806700::double precision, 98.963700::double precision, TIMESTAMPTZ '2026-07-05 10:06:00+00'),
  (18.806850::double precision, 98.963900::double precision, TIMESTAMPTZ '2026-07-05 10:15:00+00'),
  (18.806980::double precision, 98.964150::double precision, TIMESTAMPTZ '2026-07-05 10:24:00+00'),
  (18.807000::double precision, 98.964000::double precision, TIMESTAMPTZ '2026-07-05 10:33:00+00'),
  (18.806950::double precision, 98.963950::double precision, TIMESTAMPTZ '2026-07-05 10:40:00+00')
) AS ping(lat, lng, recorded_at);

COMMIT;
