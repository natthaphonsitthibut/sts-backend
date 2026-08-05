ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS scope_policy TEXT NOT NULL DEFAULT 'ASSIGNABLE',
  ADD COLUMN IF NOT EXISTS is_assignable BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_scope_policy'
  ) THEN
    ALTER TABLE roles
      ADD CONSTRAINT chk_roles_scope_policy
      CHECK (scope_policy IN ('ASSIGNABLE', 'OWN_ONLY'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS role_definition_migration_backup (
  name TEXT PRIMARY KEY,
  old_rank INTEGER NOT NULL,
  old_scope_mode TEXT NOT NULL,
  old_is_system BOOLEAN NOT NULL
);

INSERT INTO role_definition_migration_backup (name, old_rank, old_scope_mode, old_is_system)
SELECT name, rank, scope_mode, is_system
FROM roles
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_role_scope_migration_backup (
  user_id INTEGER PRIMARY KEY,
  old_role TEXT,
  old_permissions JSONB NOT NULL,
  old_data_scope JSONB NOT NULL
);

INSERT INTO user_role_scope_migration_backup (user_id, old_role, old_permissions, old_data_scope)
SELECT id, role, COALESCE(permissions, '[]'::jsonb), COALESCE(data_scope, '{}'::jsonb)
FROM users
WHERE role IN ('ADMIN_PROVINCE', 'ADMIN_DISTRICT', 'ADMIN_SUBDISTRICT', 'ADMIN_SCHOOL')
   OR COALESCE(data_scope, '{}'::jsonb) = '{}'::jsonb
   OR (role = 'STUDENT' AND COALESCE((data_scope ->> 'own_only')::boolean, FALSE) = FALSE)
ON CONFLICT (user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS task_link_role_scope_migration_backup (
  task_link_id TEXT PRIMARY KEY,
  old_login_role TEXT,
  old_login_permissions JSONB NOT NULL,
  old_login_data_scope JSONB NOT NULL
);

INSERT INTO task_link_role_scope_migration_backup (
  task_link_id, old_login_role, old_login_permissions, old_login_data_scope
)
SELECT id, login_role, COALESCE(login_permissions, '[]'::jsonb), COALESCE(login_data_scope, '{}'::jsonb)
FROM task_links
WHERE login_role IN ('ADMIN_PROVINCE', 'ADMIN_DISTRICT', 'ADMIN_SUBDISTRICT', 'ADMIN_SCHOOL')
   OR (login_role IS NOT NULL AND COALESCE(login_data_scope, '{}'::jsonb) = '{}'::jsonb)
ON CONFLICT (task_link_id) DO NOTHING;

UPDATE users u
SET permissions = r.default_permissions
FROM roles r
WHERE u.role = r.name
  AND u.role IN ('ADMIN_PROVINCE', 'ADMIN_DISTRICT', 'ADMIN_SUBDISTRICT', 'ADMIN_SCHOOL')
  AND COALESCE(u.permissions, '[]'::jsonb) = '[]'::jsonb;

UPDATE users
SET role = 'ADMIN'
WHERE role IN ('ADMIN_PROVINCE', 'ADMIN_DISTRICT', 'ADMIN_SUBDISTRICT', 'ADMIN_SCHOOL');

UPDATE users
SET data_scope = (COALESCE(data_scope, '{}'::jsonb) - 'global') || '{"own_only":true}'::jsonb
WHERE role = 'STUDENT'
  AND COALESCE((data_scope ->> 'own_only')::boolean, FALSE) = FALSE;

UPDATE users
SET data_scope = COALESCE(data_scope, '{}'::jsonb) || '{"global":true}'::jsonb
WHERE role <> 'STUDENT'
  AND COALESCE(data_scope, '{}'::jsonb) = '{}'::jsonb;

UPDATE task_links tl
SET login_permissions = r.default_permissions
FROM roles r
WHERE tl.login_role = r.name
  AND tl.login_role IN ('ADMIN_PROVINCE', 'ADMIN_DISTRICT', 'ADMIN_SUBDISTRICT', 'ADMIN_SCHOOL')
  AND COALESCE(tl.login_permissions, '[]'::jsonb) = '[]'::jsonb;

UPDATE task_links
SET login_role = 'ADMIN'
WHERE login_role IN ('ADMIN_PROVINCE', 'ADMIN_DISTRICT', 'ADMIN_SUBDISTRICT', 'ADMIN_SCHOOL');

UPDATE task_links
SET login_data_scope = CASE
    WHEN login_role = 'STUDENT' THEN
      (COALESCE(login_data_scope, '{}'::jsonb) - 'global') || '{"own_only":true}'::jsonb
    ELSE COALESCE(login_data_scope, '{}'::jsonb) || '{"global":true}'::jsonb
  END
WHERE login_role IS NOT NULL
  AND COALESCE(login_data_scope, '{}'::jsonb) = '{}'::jsonb;

UPDATE roles
SET rank = CASE name
    WHEN 'ADMIN' THEN 5
    WHEN 'DIRECTOR' THEN 4
    WHEN 'EXECUTIVE' THEN 3
    WHEN 'TEACHER' THEN 2
    WHEN 'STUDENT' THEN 1
  END,
  scope_mode = 'flexible',
  scope_policy = CASE WHEN name = 'STUDENT' THEN 'OWN_ONLY' ELSE 'ASSIGNABLE' END,
  is_assignable = TRUE,
  is_system = TRUE
WHERE name IN ('ADMIN', 'DIRECTOR', 'EXECUTIVE', 'TEACHER', 'STUDENT');

UPDATE roles
SET is_assignable = FALSE
WHERE name IN ('ADMIN_PROVINCE', 'ADMIN_DISTRICT', 'ADMIN_SUBDISTRICT', 'ADMIN_SCHOOL');
