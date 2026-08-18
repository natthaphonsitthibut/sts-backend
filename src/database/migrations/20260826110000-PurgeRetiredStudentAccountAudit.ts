import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Student accounts were retired: nothing can write these actions any more, and
 * the owner asked for the remaining history to go with the feature so the audit
 * log only lists actions the system can still produce.
 *
 * This is deliberately irreversible — `audit_log` is append-only behind
 * `trg_audit_log_immutable`, so the trigger is dropped for the delete and put
 * back immediately. `down()` cannot restore the rows; recovery needs a dump
 * taken before the deploy.
 */
const RETIRED_ACTIONS = [
  'STUDENT_ACCOUNT_BULK_GENERATE',
  'STUDENT_ACCOUNT_BATCH_ENQUEUE',
  'STUDENT_ACCOUNT_BATCH_COMPLETED',
  'STUDENT_ACCOUNT_BATCH_FAILED',
  'STUDENT_ACCOUNT_BATCH_RESUME',
  'STUDENT_ACCOUNT_BATCH_CANCEL',
  'STUDENT_ACCOUNT_DEACTIVATE',
  'STUDENT_ACCOUNT_REACTIVATE',
  'STUDENT_TEMP_PASSWORD_REISSUE',
];

export class PurgeRetiredStudentAccountAudit20260826110000 implements MigrationInterface {
  name = 'PurgeRetiredStudentAccountAudit20260826110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [stillWritten] = (await queryRunner.query(
      `
        SELECT COUNT(*)::int AS recent_count
        FROM audit_log
        WHERE action = ANY($1::text[])
          AND created_at > NOW() - INTERVAL '1 day'
      `,
      [RETIRED_ACTIONS],
    )) as Array<{ recent_count: number }>;
    if (stillWritten && stillWritten.recent_count > 0) {
      throw new Error(
        `PurgeRetiredStudentAccountAudit: ${stillWritten.recent_count} row(s) were written in the last day, so a writer still exists; investigate before purging.`,
      );
    }

    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log`);
    await queryRunner.query(`DELETE FROM audit_log WHERE action = ANY($1::text[])`, [
      RETIRED_ACTIONS,
    ]);
    await queryRunner.query(`
      CREATE TRIGGER trg_audit_log_immutable
        BEFORE UPDATE OR DELETE ON audit_log
        FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation()
    `);
  }

  /** Deleted audit history cannot be reconstructed; restore from a dump instead. */
  public down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    return Promise.resolve();
  }
}
