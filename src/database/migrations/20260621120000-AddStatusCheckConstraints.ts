import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A7 — pin the free-text status columns with CHECK constraints so an invalid
 * status can never be written. Values were audited from the code paths that
 * write each column plus the seed data, NOT invented:
 *
 *   cases.status  (case.service resolveStatus + task-stats counters + seed):
 *     OPEN, IN_PROGRESS, AWAITING_HELP, PENDING_REVIEW, RESOLVED
 *   tasks.status  (createTask='IN_PROGRESS', updateTaskStatus='COMPLETED',
 *     submitFollowup='PENDING_REVIEW', seed 'ACTIVE'):
 *     OPEN, ACTIVE, IN_PROGRESS, COMPLETED, PENDING_REVIEW
 *
 * tasks.status carried a stale column default of 'PENDING' (never written by
 * app code — createTask always sets 'IN_PROGRESS') which is NOT an allowed
 * value, so this also realigns the default to 'IN_PROGRESS' before adding the
 * check; otherwise any future insert omitting status would fail the constraint.
 *
 * A CHECK is satisfied by NULL, so any legacy NULL status is left untouched.
 * Added `NOT VALID` first (enforces new writes immediately, no full-table lock)
 * then `VALIDATE` (checks existing rows) — if VALIDATE fails it surfaces real
 * drift rather than silently accepting bad data. Additive + reversible.
 */
export class AddStatusCheckConstraints20260621120000 implements MigrationInterface {
  name = 'AddStatusCheckConstraints20260621120000';

  private static readonly CASES_STATUSES =
    "'OPEN','IN_PROGRESS','AWAITING_HELP','PENDING_REVIEW','RESOLVED'";

  private static readonly TASKS_STATUSES =
    "'OPEN','ACTIVE','IN_PROGRESS','COMPLETED','PENDING_REVIEW'";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE cases DROP CONSTRAINT IF EXISTS chk_cases_status`);
    await queryRunner.query(
      `ALTER TABLE cases ADD CONSTRAINT chk_cases_status ` +
        `CHECK (status IN (${AddStatusCheckConstraints20260621120000.CASES_STATUSES})) NOT VALID`,
    );
    await queryRunner.query(`ALTER TABLE cases VALIDATE CONSTRAINT chk_cases_status`);

    await queryRunner.query(`ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'IN_PROGRESS'`);
    await queryRunner.query(`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_status`);
    await queryRunner.query(
      `ALTER TABLE tasks ADD CONSTRAINT chk_tasks_status ` +
        `CHECK (status IN (${AddStatusCheckConstraints20260621120000.TASKS_STATUSES})) NOT VALID`,
    );
    await queryRunner.query(`ALTER TABLE tasks VALIDATE CONSTRAINT chk_tasks_status`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS chk_tasks_status`);
    await queryRunner.query(`ALTER TABLE tasks ALTER COLUMN status SET DEFAULT 'PENDING'`);
    await queryRunner.query(`ALTER TABLE cases DROP CONSTRAINT IF EXISTS chk_cases_status`);
  }
}
