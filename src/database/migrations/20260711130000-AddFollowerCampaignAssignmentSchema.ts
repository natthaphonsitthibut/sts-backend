import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

export class AddFollowerCampaignAssignmentSchema20260711130000 implements MigrationInterface {
  name = 'AddFollowerCampaignAssignmentSchema20260711130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS follower_recruitment_campaign_targets (
        id BIGSERIAL PRIMARY KEY,
        campaign_id BIGINT NOT NULL
          CONSTRAINT fk_frct_campaign
          REFERENCES follower_recruitment_campaigns(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        case_id INTEGER NOT NULL
          CONSTRAINT fk_frct_case
          REFERENCES cases(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        status VARCHAR(16) NOT NULL DEFAULT 'OPEN'
          CONSTRAINT chk_frct_status
          CHECK (status IN ('OPEN', 'ASSIGNED', 'COMPLETED', 'CANCELED')),
        assigned_follower_id BIGINT NULL
          CONSTRAINT fk_frct_follower
          REFERENCES field_followers(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        assigned_task_link_id UUID NULL
          CONSTRAINT fk_frct_task_link
          REFERENCES task_links(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        assigned_at TIMESTAMPTZ NULL,
        assigned_by INTEGER NULL
          CONSTRAINT fk_frct_assigned_by
          REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT uq_frct_campaign_case UNIQUE (campaign_id, case_id)
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('follower_recruitment_campaign_targets'));
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_frct_campaign_status
        ON follower_recruitment_campaign_targets (campaign_id, status)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_frct_follower
        ON follower_recruitment_campaign_targets (assigned_follower_id)
        WHERE assigned_follower_id IS NOT NULL
    `);

    await queryRunner.query(`ALTER TABLE field_followers ADD COLUMN IF NOT EXISTS email TEXT NULL`);
    await queryRunner.query(
      `ALTER TABLE field_followers ADD COLUMN IF NOT EXISTS gender VARCHAR(20) NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE field_followers
        ADD COLUMN IF NOT EXISTS verification_method VARCHAR(16) NOT NULL DEFAULT 'PENDING'
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'chk_field_followers_verification_method'
        ) THEN
          ALTER TABLE field_followers
            ADD CONSTRAINT chk_field_followers_verification_method
            CHECK (verification_method IN ('THAID', 'ID_CARD_PHOTO', 'PENDING'));
        END IF;
      END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE field_followers ADD COLUMN IF NOT EXISTS thaid_person_ref TEXT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE field_followers ADD COLUMN IF NOT EXISTS id_card_photo_filename TEXT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE field_followers ADD COLUMN IF NOT EXISTS id_card_photo_uploaded_at TIMESTAMPTZ NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE field_followers ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE field_followers
        ADD COLUMN IF NOT EXISTS verified_by_user_id INTEGER NULL
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_field_followers_verified_by'
        ) THEN
          ALTER TABLE field_followers
            ADD CONSTRAINT fk_field_followers_verified_by
            FOREIGN KEY (verified_by_user_id)
            REFERENCES users(id)
            ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_field_followers_verification_method
        ON field_followers (verification_method)
    `);

    await queryRunner.query(`
      ALTER TABLE task_links
        ADD COLUMN IF NOT EXISTS source_field_follower_id BIGINT NULL
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'fk_task_links_field_follower'
        ) THEN
          ALTER TABLE task_links
            ADD CONSTRAINT fk_task_links_field_follower
            FOREIGN KEY (source_field_follower_id)
            REFERENCES field_followers(id)
            ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_task_links_source_field_follower
        ON task_links (source_field_follower_id)
        WHERE source_field_follower_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_task_links_source_field_follower`);
    await queryRunner.query(
      `ALTER TABLE task_links DROP CONSTRAINT IF EXISTS fk_task_links_field_follower`,
    );
    await queryRunner.query(
      `ALTER TABLE task_links DROP COLUMN IF EXISTS source_field_follower_id`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS idx_field_followers_verification_method`);
    await queryRunner.query(
      `ALTER TABLE field_followers DROP CONSTRAINT IF EXISTS fk_field_followers_verified_by`,
    );
    await queryRunner.query(
      `ALTER TABLE field_followers DROP COLUMN IF EXISTS verified_by_user_id`,
    );
    await queryRunner.query(`ALTER TABLE field_followers DROP COLUMN IF EXISTS verified_at`);
    await queryRunner.query(
      `ALTER TABLE field_followers DROP COLUMN IF EXISTS id_card_photo_uploaded_at`,
    );
    await queryRunner.query(
      `ALTER TABLE field_followers DROP COLUMN IF EXISTS id_card_photo_filename`,
    );
    await queryRunner.query(`ALTER TABLE field_followers DROP COLUMN IF EXISTS thaid_person_ref`);
    await queryRunner.query(
      `ALTER TABLE field_followers DROP CONSTRAINT IF EXISTS chk_field_followers_verification_method`,
    );
    await queryRunner.query(
      `ALTER TABLE field_followers DROP COLUMN IF EXISTS verification_method`,
    );
    await queryRunner.query(`ALTER TABLE field_followers DROP COLUMN IF EXISTS gender`);
    await queryRunner.query(`ALTER TABLE field_followers DROP COLUMN IF EXISTS email`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_frct_follower`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_frct_campaign_status`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_follower_recruitment_campaign_targets_set_updated_at ON follower_recruitment_campaign_targets`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS follower_recruitment_campaign_targets`);
  }
}
