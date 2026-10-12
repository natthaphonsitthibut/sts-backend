import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Serialize catalog rule changes with report writes and refuse invalidating saved details. */
export class GuardContactChannelDetailRules20261012150000 implements MigrationInterface {
  name = 'GuardContactChannelDetailRules20261012150000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX idx_task_submissions_contact_detail_channel
        ON task_submissions(contact_channel_code) WHERE contact_channel_detail IS NOT NULL;
      CREATE OR REPLACE FUNCTION enforce_task_submission_contact_channel_detail()
      RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
      BEGIN
        IF NEW.contact_channel_detail IS NOT NULL THEN
          PERFORM 1 FROM contact_channel_options channel
          WHERE channel.code = NEW.contact_channel_code AND channel.requires_detail
          FOR SHARE;
          IF NOT FOUND THEN
            RAISE EXCEPTION 'contact channel does not allow a detail'
              USING ERRCODE = '23514', CONSTRAINT = 'chk_task_submissions_contact_channel_detail_catalog';
          END IF;
        END IF;
        RETURN NEW;
      END $$;
      CREATE FUNCTION guard_contact_channel_detail_rule_change()
      RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
      BEGIN
        IF OLD.requires_detail AND NOT NEW.requires_detail AND EXISTS (
          SELECT 1 FROM task_submissions submission
          WHERE submission.contact_channel_code = OLD.code AND submission.contact_channel_detail IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'contact channel has reports with details'
            USING ERRCODE = '23514', CONSTRAINT = 'chk_contact_channel_options_saved_details';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_contact_channel_options_saved_details
        BEFORE UPDATE OF requires_detail ON contact_channel_options FOR EACH ROW
        EXECUTE FUNCTION guard_contact_channel_detail_rule_change()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER trg_contact_channel_options_saved_details ON contact_channel_options;
      DROP FUNCTION guard_contact_channel_detail_rule_change();
      DROP INDEX idx_task_submissions_contact_detail_channel;
      CREATE OR REPLACE FUNCTION enforce_task_submission_contact_channel_detail()
      RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
      BEGIN
        IF NEW.contact_channel_detail IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM contact_channel_options channel
          WHERE channel.code = NEW.contact_channel_code AND channel.requires_detail
        ) THEN
          RAISE EXCEPTION 'contact channel does not allow a detail'
            USING ERRCODE = '23514', CONSTRAINT = 'chk_task_submissions_contact_channel_detail_catalog';
        END IF;
        RETURN NEW;
      END $$
    `);
  }
}
