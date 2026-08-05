-- audit-log endpoints are now gated by a dedicated `audit-log` permission.
-- Grant it to governance roles so existing admins keep audit access. Idempotent.
UPDATE roles
SET default_permissions = default_permissions || '["audit-log"]'::jsonb
WHERE name IN ('ADMIN','DIRECTOR')
  AND NOT (default_permissions ? 'audit-log');

UPDATE users
SET permissions = permissions || '["audit-log"]'::jsonb
WHERE role IN ('ADMIN','DIRECTOR')
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT (permissions ? 'audit-log');
