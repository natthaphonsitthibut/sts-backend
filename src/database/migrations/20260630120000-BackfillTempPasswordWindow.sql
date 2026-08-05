-- Backfill a fresh 7-day temporary-password window for any account (any role)
-- created with a temp password before the expiry feature (migration 20260628120000)
-- so the admin table shows start/end dates and login enforces expiry.
-- Matches TEMP_PASSWORD_TTL_DAYS.
UPDATE users
SET temporary_password_issued_at = now(),
    temporary_password_expires_at = now() + INTERVAL '7 days'
WHERE status = 'ACTIVE'
  AND must_change_password = TRUE
  AND temporary_password_expires_at IS NULL;
