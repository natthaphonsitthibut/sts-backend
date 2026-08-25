import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * Moves the follow-up contact channel from an inline CHECK list to the same
 * code catalog every neighbouring answer already uses, so the Thai label lives
 * in one place instead of being repeated in the DTO, the service and the UI.
 */
export class AddContactChannelOptions20260827312800 implements MigrationInterface {
  name = 'AddContactChannelOptions20260827312800';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $prerequisites$
      BEGIN
        IF to_regclass('public.task_submissions') IS NULL THEN
          RAISE EXCEPTION 'task_submissions prerequisite is missing';
        END IF;
        IF EXISTS (
          SELECT 1 FROM task_submissions
          WHERE contact_channel_code IS NOT NULL
            AND contact_channel_code NOT IN ('IN_PERSON', 'PHONE', 'LINE', 'OTHER')
        ) THEN
          RAISE EXCEPTION 'task_submissions hold contact channels outside the seeded catalog';
        END IF;
      END
      $prerequisites$
    `);
    await queryRunner.query(`
      CREATE TABLE contact_channel_options (
        code VARCHAR(24) PRIMARY KEY,
        label_th VARCHAR(80) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_contact_channel_options_code CHECK (
          code = UPPER(BTRIM(code)) AND CHAR_LENGTH(code) BETWEEN 1 AND 24
        ),
        CONSTRAINT chk_contact_channel_options_label CHECK (
          label_th = BTRIM(label_th) AND CHAR_LENGTH(label_th) BETWEEN 1 AND 80
        ),
        CONSTRAINT chk_contact_channel_options_sort CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('contact_channel_options'));
    await queryRunner.query(`
      INSERT INTO contact_channel_options (code, label_th, sort_order) VALUES
        ('IN_PERSON', 'พบด้วยตนเอง', 10),
        ('PHONE', 'โทรศัพท์', 20),
        ('LINE', 'LINE', 30),
        ('OTHER', 'ช่องทางอื่น', 40)
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP CONSTRAINT IF EXISTS chk_task_submissions_contact_channel_code,
        ADD CONSTRAINT fk_task_submissions_contact_channel
          FOREIGN KEY (contact_channel_code) REFERENCES contact_channel_options(code)
          ON UPDATE CASCADE ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE contact_channel_options ENABLE ROW LEVEL SECURITY
    `);
    await queryRunner.query(`
      DO $secure_contact_channel_options$
      DECLARE role_name TEXT;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON TABLE contact_channel_options FROM %I',
              role_name
            );
          END IF;
        END LOOP;
      END
      $secure_contact_channel_options$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $rollback_guard$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM task_submissions submission
          WHERE submission.contact_channel_code IS NOT NULL
            AND submission.contact_channel_code
              NOT IN ('IN_PERSON', 'PHONE', 'LINE', 'OTHER')
        ) THEN
          RAISE EXCEPTION 'refusing rollback: reports use contact channels added after the migration';
        END IF;
      END
      $rollback_guard$
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP CONSTRAINT IF EXISTS fk_task_submissions_contact_channel,
        ADD CONSTRAINT chk_task_submissions_contact_channel_code CHECK (
          contact_channel_code IS NULL
          OR contact_channel_code IN ('IN_PERSON', 'PHONE', 'LINE', 'OTHER')
        )
    `);
    await queryRunner.query(`DROP TABLE contact_channel_options`);
  }
}
