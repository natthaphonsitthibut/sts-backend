import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

export class AddDataRecordOrigins20260703140000 implements MigrationInterface {
  name = 'AddDataRecordOrigins20260703140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE data_record_origins (
        code VARCHAR(32) PRIMARY KEY,
        label_th VARCHAR(100) NOT NULL,
        is_visible_by_default BOOLEAN NOT NULL,
        sort_order SMALLINT NOT NULL,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_data_record_origins_label CHECK (length(trim(label_th)) > 0),
        CONSTRAINT chk_data_record_origins_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('data_record_origins'));
    await queryRunner.query(`
      INSERT INTO data_record_origins (code, label_th, is_visible_by_default, sort_order) VALUES
        ('OPERATIONAL', 'ข้อมูลใช้งานจริง', TRUE, 10),
        ('DEMO', 'ข้อมูลสาธิต', TRUE, 20),
        ('AUTOMATED_TEST', 'ข้อมูลทดสอบอัตโนมัติ', FALSE, 30)
    `);

    await queryRunner.query(`
      ALTER TABLE users
      ADD COLUMN data_origin_code VARCHAR(32) NOT NULL DEFAULT 'OPERATIONAL'
    `);
    await queryRunner.query(`
      UPDATE users
      SET data_origin_code = 'AUTOMATED_TEST'
      WHERE username ILIKE 'smoke\\_%' ESCAPE '\\'
         OR username ILIKE '%\\_smoke\\_%' ESCAPE '\\'
         OR username ILIKE '%\\_smoke' ESCAPE '\\'
         OR affiliation ILIKE 'Automated % smoke%'
         OR deactivation_note ILIKE '%automated%smoke%fixture%'
    `);
    await queryRunner.query(`
      ALTER TABLE users
      ADD CONSTRAINT fk_users_data_origin
      FOREIGN KEY (data_origin_code) REFERENCES data_record_origins(code)
      ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX idx_users_data_origin_code ON users (data_origin_code)
    `);

    await queryRunner.query(`
      ALTER TABLE audit_log
      ADD COLUMN data_origin_code VARCHAR(32) NOT NULL DEFAULT 'OPERATIONAL'
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_audit_log_immutable ON audit_log`);
    await queryRunner.query(`
      UPDATE audit_log audit
      SET data_origin_code = 'AUTOMATED_TEST'
      FROM users actor
      WHERE audit.actor_user_id = actor.id
        AND actor.data_origin_code = 'AUTOMATED_TEST'
    `);
    await queryRunner.query(`
      UPDATE audit_log audit
      SET data_origin_code = 'AUTOMATED_TEST'
      FROM users target
      WHERE audit.target_type = 'user'
        AND audit.target_id ~ '^[0-9]+$'
        AND target.id = audit.target_id::integer
        AND target.data_origin_code = 'AUTOMATED_TEST'
    `);
    await queryRunner.query(`
      UPDATE audit_log
      SET data_origin_code = 'AUTOMATED_TEST'
      WHERE data_origin_code = 'OPERATIONAL'
        AND (
          actor_label ILIKE '%smoke%'
          OR COALESCE(metadata ->> 'username', '') ILIKE 'smoke\\_%' ESCAPE '\\'
          OR COALESCE(metadata ->> 'username', '') ILIKE '%\\_smoke%' ESCAPE '\\'
          OR COALESCE(metadata ->> 'note', '') ILIKE '%automated%smoke%'
          OR COALESCE(metadata ->> 'smoke_key', '') <> ''
        )
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_audit_log_immutable
      BEFORE UPDATE OR DELETE ON audit_log
      FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation()
    `);
    await queryRunner.query(`
      ALTER TABLE audit_log
      ADD CONSTRAINT fk_audit_log_data_origin
      FOREIGN KEY (data_origin_code) REFERENCES data_record_origins(code)
      ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX idx_audit_log_data_origin_created_at
      ON audit_log (data_origin_code, created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_audit_log_data_origin_created_at`);
    await queryRunner.query(`
      ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS fk_audit_log_data_origin
    `);
    await queryRunner.query(`ALTER TABLE audit_log DROP COLUMN data_origin_code`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_users_data_origin_code`);
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_data_origin`);
    await queryRunner.query(`ALTER TABLE users DROP COLUMN data_origin_code`);
    await queryRunner.query(`DROP TABLE data_record_origins`);
  }
}
