import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

export class AddFollowerRecruitmentCampaigns20260709120000 implements MigrationInterface {
  name = 'AddFollowerRecruitmentCampaigns20260709120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS follower_recruitment_campaigns (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL
          CONSTRAINT chk_frc_name_not_blank CHECK (btrim(name) <> ''),
        description TEXT NULL,
        public_code TEXT NOT NULL
          CONSTRAINT uq_frc_public_code UNIQUE
          CONSTRAINT chk_frc_public_code_format CHECK (public_code ~ '^[A-Za-z0-9_-]{12,64}$'),
        data_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT true,
        opens_at TIMESTAMPTZ NULL,
        closes_at TIMESTAMPTZ NULL,
        view_count BIGINT NOT NULL DEFAULT 0
          CONSTRAINT chk_frc_view_count_nonneg CHECK (view_count >= 0),
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT chk_frc_window CHECK (
          opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at
        )
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('follower_recruitment_campaigns'));
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_frc_active_live
        ON follower_recruitment_campaigns (is_active)
        WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_frc_created_at
        ON follower_recruitment_campaigns (created_at DESC)
    `);

    await queryRunner.query(`
      ALTER TABLE field_followers
        ADD COLUMN IF NOT EXISTS campaign_id BIGINT NULL
          CONSTRAINT fk_field_followers_campaign
          REFERENCES follower_recruitment_campaigns(id)
          ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_field_followers_campaign_id
        ON field_followers (campaign_id)
        WHERE campaign_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_field_followers_campaign_id`);
    await queryRunner.query(
      `ALTER TABLE field_followers DROP CONSTRAINT IF EXISTS fk_field_followers_campaign`,
    );
    await queryRunner.query(`ALTER TABLE field_followers DROP COLUMN IF EXISTS campaign_id`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_frc_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_frc_active_live`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_follower_recruitment_campaigns_set_updated_at ON follower_recruitment_campaigns`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS follower_recruitment_campaigns`);
  }
}
