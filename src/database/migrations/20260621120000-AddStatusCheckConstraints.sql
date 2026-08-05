-- Migration: AddStatusCheckConstraints20260621120000
-- A7: pin cases.status / tasks.status free-text columns with CHECK constraints.
-- Values audited from the code paths that write each column + seed data:
--   cases.status: OPEN, IN_PROGRESS, AWAITING_HELP, PENDING_REVIEW, RESOLVED
--   tasks.status: OPEN, ACTIVE, IN_PROGRESS, COMPLETED, PENDING_REVIEW
-- A CHECK passes on NULL, so legacy NULL status rows are left untouched.
-- NOT VALID first (no full lock, enforces new writes) then VALIDATE (checks
-- existing rows; failure surfaces real drift). Additive + reversible.

-- == up ==
ALTER TABLE cases DROP CONSTRAINT IF EXISTS chk_cases_status;
ALTER TABLE cases ADD CONSTRAINT chk_cases_status
  CHECK (status IN ('OPEN','IN_PROGRESS','AWAITING_HELP','PENDING_REVIEW','RESOLVED')) NOT VALID;
ALTER TABLE cases VALIDATE CONSTRAINT chk_cases_status;

-- Realign the stale 'PENDING' default (never written by app code) to an
-- allowed value before adding the check, so a future default-insert can't fail.
ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'IN_PROGRESS';
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_status;
ALTER TABLE tasks ADD CONSTRAINT chk_tasks_status
  CHECK (status IN ('OPEN','ACTIVE','IN_PROGRESS','COMPLETED','PENDING_REVIEW')) NOT VALID;
ALTER TABLE tasks VALIDATE CONSTRAINT chk_tasks_status;

-- == down ==
-- ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_status;
-- ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'PENDING';
-- ALTER TABLE cases DROP CONSTRAINT IF EXISTS chk_cases_status;
