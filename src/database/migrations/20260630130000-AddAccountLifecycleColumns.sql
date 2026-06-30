-- Soft-deactivate / reactivate metadata for accounts of any role + canonicalize
-- users.status to ACTIVE/DISABLED. PENDING_FIRST_LOGIN / TEMP_PASSWORD_EXPIRED stay derived.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS deactivated_by INTEGER,
  ADD COLUMN IF NOT EXISTS deactivation_reason_code VARCHAR(32),
  ADD COLUMN IF NOT EXISTS deactivation_note VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_deactivated_by') THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_deactivated_by
      FOREIGN KEY (deactivated_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_deactivation_reason_code') THEN
    ALTER TABLE users
      ADD CONSTRAINT chk_users_deactivation_reason_code
      CHECK (
        deactivation_reason_code IS NULL
        OR deactivation_reason_code IN ('STAFF_LEFT','TRANSFERRED','DUPLICATE','SECURITY','OTHER')
      );
  END IF;
END $$;

UPDATE users SET status = 'DISABLED' WHERE status NOT IN ('ACTIVE','DISABLED');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_status') THEN
    ALTER TABLE users
      ADD CONSTRAINT chk_users_status CHECK (status IN ('ACTIVE','DISABLED')) NOT VALID;
    ALTER TABLE users VALIDATE CONSTRAINT chk_users_status;
  END IF;
END $$;
