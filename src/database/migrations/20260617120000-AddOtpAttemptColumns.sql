-- H1 brute-force defense: durable OTP attempt lockout for magic links.
-- A 6-digit OTP with a 10-minute window needs a per-link attempt cap; these two
-- additive columns track failed guesses and the lockout window on the row so the
-- limit survives restarts and is shared across instances. Additive + reversible.

-- up
ALTER TABLE task_links ADD COLUMN IF NOT EXISTS otp_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE task_links ADD COLUMN IF NOT EXISTS otp_locked_until TIMESTAMP WITH TIME ZONE;

-- == down == (see the .ts migration's down(); commented so running this file
-- manually does not immediately drop what it just created)
-- ALTER TABLE task_links DROP COLUMN IF EXISTS otp_locked_until;
-- ALTER TABLE task_links DROP COLUMN IF EXISTS otp_attempts;
