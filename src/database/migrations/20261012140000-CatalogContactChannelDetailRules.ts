import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Keep detail rules on the channel catalog; legacy reports may still have no detail. */
export class CatalogContactChannelDetailRules20261012140000 implements MigrationInterface {
  name = 'CatalogContactChannelDetailRules20261012140000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contact_channel_options
        ADD COLUMN requires_detail BOOLEAN NOT NULL DEFAULT FALSE;
      UPDATE contact_channel_options SET requires_detail = TRUE WHERE code = 'OTHER';
      ALTER TABLE task_submissions
        DROP CONSTRAINT chk_task_submissions_contact_channel_detail,
        ADD CONSTRAINT chk_task_submissions_contact_channel_detail CHECK (
          contact_channel_detail IS NULL OR (
            contact_channel_code IS NOT NULL
            AND char_length(btrim(contact_channel_detail)) BETWEEN 1 AND 200
          )
        )
    `);
    await queryRunner.query(`
      CREATE FUNCTION enforce_task_submission_contact_channel_detail()
      RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
      BEGIN
        IF NEW.contact_channel_detail IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM contact_channel_options channel
          WHERE channel.code = NEW.contact_channel_code AND channel.requires_detail
        ) THEN
          RAISE EXCEPTION 'contact channel does not allow a detail'
            USING ERRCODE = '23514',
              CONSTRAINT = 'chk_task_submissions_contact_channel_detail_catalog';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_task_submissions_contact_channel_detail
        BEFORE INSERT OR UPDATE OF contact_channel_code, contact_channel_detail
        ON task_submissions FOR EACH ROW
        EXECUTE FUNCTION enforce_task_submission_contact_channel_detail()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM task_submissions
          WHERE contact_channel_detail IS NOT NULL
            AND contact_channel_code IS DISTINCT FROM 'OTHER'
        ) THEN
          RAISE EXCEPTION 'refusing rollback: reports use another detail-bearing contact channel';
        END IF;
      END $$;
      DROP TRIGGER trg_task_submissions_contact_channel_detail ON task_submissions;
      DROP FUNCTION enforce_task_submission_contact_channel_detail();
      ALTER TABLE task_submissions
        DROP CONSTRAINT chk_task_submissions_contact_channel_detail,
        ADD CONSTRAINT chk_task_submissions_contact_channel_detail CHECK (
          contact_channel_detail IS NULL OR (
            contact_channel_code IS NOT DISTINCT FROM 'OTHER'
            AND char_length(btrim(contact_channel_detail)) BETWEEN 1 AND 200
          )
        );
      ALTER TABLE contact_channel_options DROP COLUMN requires_detail
    `);
  }
}
