-- Scoped reads now fail closed on a semantically-empty data scope. Mark every
-- account / LOGIN link whose nationwide intent was stored as an empty object
-- with an explicit global:true (or own_only:true for OWN_ONLY roles), so they
-- keep working after the fail-closed read path ships.
-- Mirrors 20260629160000, generalized to custom roles via roles.scope_policy.

CREATE TABLE IF NOT EXISTS user_scope_backfill_20260702_backup (
  user_id INTEGER PRIMARY KEY,
  old_data_scope JSONB
);

INSERT INTO user_scope_backfill_20260702_backup (user_id, old_data_scope)
SELECT u.id, u.data_scope
FROM users u
JOIN roles r ON r.name = u.role
WHERE jsonb_typeof(COALESCE(u.data_scope, '{}'::jsonb)) = 'object'
  AND (COALESCE(u.data_scope, '{}'::jsonb) -> 'global') IS DISTINCT FROM 'true'::jsonb
  AND (COALESCE(u.data_scope, '{}'::jsonb) -> 'own_only') IS DISTINCT FROM 'true'::jsonb
  AND (jsonb_typeof(COALESCE(u.data_scope, '{}'::jsonb) -> 'provinces') IS DISTINCT FROM 'array'
       OR jsonb_array_length(COALESCE(u.data_scope, '{}'::jsonb) -> 'provinces') = 0)
  AND (jsonb_typeof(COALESCE(u.data_scope, '{}'::jsonb) -> 'districts') IS DISTINCT FROM 'array'
       OR jsonb_array_length(COALESCE(u.data_scope, '{}'::jsonb) -> 'districts') = 0)
  AND (jsonb_typeof(COALESCE(u.data_scope, '{}'::jsonb) -> 'sub_districts') IS DISTINCT FROM 'array'
       OR jsonb_array_length(COALESCE(u.data_scope, '{}'::jsonb) -> 'sub_districts') = 0)
  AND (jsonb_typeof(COALESCE(u.data_scope, '{}'::jsonb) -> 'school_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(COALESCE(u.data_scope, '{}'::jsonb) -> 'school_ids') = 0)
  AND (jsonb_typeof(COALESCE(u.data_scope, '{}'::jsonb) -> 'grade_levels') IS DISTINCT FROM 'array'
       OR jsonb_array_length(COALESCE(u.data_scope, '{}'::jsonb) -> 'grade_levels') = 0)
  AND (jsonb_typeof(COALESCE(u.data_scope, '{}'::jsonb) -> 'room_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(COALESCE(u.data_scope, '{}'::jsonb) -> 'room_ids') = 0)
ON CONFLICT (user_id) DO NOTHING;

UPDATE users u
SET data_scope = CASE
  WHEN r.scope_policy = 'OWN_ONLY' THEN '{"own_only":true}'::jsonb
  ELSE COALESCE(u.data_scope, '{}'::jsonb) || '{"global":true}'::jsonb
END
FROM roles r
WHERE r.name = u.role
  AND u.id IN (SELECT user_id FROM user_scope_backfill_20260702_backup);

CREATE TABLE IF NOT EXISTS task_link_scope_backfill_20260702_backup (
  task_link_id TEXT PRIMARY KEY,
  old_login_data_scope JSONB
);

INSERT INTO task_link_scope_backfill_20260702_backup (task_link_id, old_login_data_scope)
SELECT tl.id, tl.login_data_scope
FROM task_links tl
JOIN roles r ON r.name = tl.login_role
WHERE tl.login_role IS NOT NULL
  AND jsonb_typeof(COALESCE(tl.login_data_scope, '{}'::jsonb)) = 'object'
  AND (COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'global') IS DISTINCT FROM 'true'::jsonb
  AND (COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'own_only') IS DISTINCT FROM 'true'::jsonb
  AND (jsonb_typeof(COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'provinces') IS DISTINCT FROM 'array'
       OR jsonb_array_length(COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'provinces') = 0)
  AND (jsonb_typeof(COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'districts') IS DISTINCT FROM 'array'
       OR jsonb_array_length(COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'districts') = 0)
  AND (jsonb_typeof(COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'sub_districts') IS DISTINCT FROM 'array'
       OR jsonb_array_length(COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'sub_districts') = 0)
  AND (jsonb_typeof(COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'school_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'school_ids') = 0)
  AND (jsonb_typeof(COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'grade_levels') IS DISTINCT FROM 'array'
       OR jsonb_array_length(COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'grade_levels') = 0)
  AND (jsonb_typeof(COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'room_ids') IS DISTINCT FROM 'array'
       OR jsonb_array_length(COALESCE(tl.login_data_scope, '{}'::jsonb) -> 'room_ids') = 0)
ON CONFLICT (task_link_id) DO NOTHING;

UPDATE task_links tl
SET login_data_scope = CASE
  WHEN r.scope_policy = 'OWN_ONLY' THEN '{"own_only":true}'::jsonb
  ELSE COALESCE(tl.login_data_scope, '{}'::jsonb) || '{"global":true}'::jsonb
END
FROM roles r
WHERE r.name = tl.login_role
  AND tl.id IN (SELECT task_link_id FROM task_link_scope_backfill_20260702_backup);
