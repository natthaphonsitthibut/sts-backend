import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A reveal of personal data is one event kept in two places: the PDPA access
 * record (`pii_access_events`) and the row บันทึกการใช้งาน lists (`audit_log`).
 * The link makes that pairing a real reference instead of two rows that only
 * happen to share a timestamp. Reveals recorded before this stay unlinked.
 */
export class LinkPiiAccessEventsToAuditLog20261011120000 implements MigrationInterface {
  name = 'LinkPiiAccessEventsToAuditLog20261011120000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        ADD COLUMN audit_log_id BIGINT,
        ADD CONSTRAINT fk_pii_access_events_audit_log
          FOREIGN KEY (audit_log_id) REFERENCES audit_log(id)
          ON DELETE RESTRICT ON UPDATE RESTRICT
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_pii_access_events_audit_log_id
        ON pii_access_events (audit_log_id)
        WHERE audit_log_id IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX uq_pii_access_events_audit_log_id`);
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        DROP CONSTRAINT fk_pii_access_events_audit_log,
        DROP COLUMN audit_log_id
    `);
  }
}
