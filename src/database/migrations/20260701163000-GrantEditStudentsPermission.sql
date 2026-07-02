-- Direct student-record edits are gated by `edit-students`, separate from read access.
UPDATE roles
SET default_permissions = default_permissions || '["edit-students"]'::jsonb
WHERE name IN ('ADMIN','DIRECTOR')
  AND NOT (default_permissions ? 'edit-students');

UPDATE users
SET permissions = permissions || '["edit-students"]'::jsonb
WHERE role IN ('ADMIN','DIRECTOR')
  AND jsonb_typeof(permissions) = 'array'
  AND jsonb_array_length(permissions) > 0
  AND NOT (permissions ? 'edit-students');
