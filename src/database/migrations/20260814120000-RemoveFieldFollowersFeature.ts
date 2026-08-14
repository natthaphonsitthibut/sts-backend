import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * Retires the field-follower recruitment feature without discarding production
 * records. Application tables disappear from their live names, while isolated
 * migration-owned archive tables retain row data for a lossless rollback. A
 * later, separately reviewed retention migration may purge those archives once
 * the owner and PDPA policy confirm that rollback is no longer required.
 */
export class RemoveFieldFollowersFeature20260814120000 implements MigrationInterface {
  name = 'RemoveFieldFollowersFeature20260814120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE retired_follower_recruitment_campaigns_20260814
      AS TABLE follower_recruitment_campaigns WITH DATA
    `);
    await queryRunner.query(`
      CREATE TABLE retired_field_followers_20260814
      AS TABLE field_followers WITH DATA
    `);
    await queryRunner.query(`
      CREATE TABLE retired_follower_recruitment_campaign_targets_20260814
      AS TABLE follower_recruitment_campaign_targets WITH DATA
    `);
    await queryRunner.query(`
      CREATE TABLE retired_task_link_field_follower_refs_20260814 AS
      SELECT id AS task_link_id, source_field_follower_id
      FROM task_links
      WHERE source_field_follower_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE retired_field_follower_display_states_20260814 AS
      SELECT *
      FROM application_display_states
      WHERE domain_code IN ('FIELD_FOLLOWER_STATUS', 'RECRUITMENT_CAMPAIGN_STATE')
    `);
    await queryRunner.query(`
      COMMENT ON TABLE retired_field_followers_20260814 IS
        'Rollback archive for RemoveFieldFollowersFeature20260814120000; not application-readable'
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_task_links_source_field_follower`);
    await queryRunner.query(
      `ALTER TABLE task_links DROP CONSTRAINT IF EXISTS fk_task_links_field_follower`,
    );
    await queryRunner.query(
      `ALTER TABLE task_links DROP COLUMN IF EXISTS source_field_follower_id`,
    );

    await queryRunner.query(`DROP INDEX IF EXISTS idx_frct_follower`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_frct_campaign_status`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_follower_recruitment_campaign_targets_set_updated_at ON follower_recruitment_campaign_targets`,
    );
    await queryRunner.query(`DROP TABLE follower_recruitment_campaign_targets`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_field_followers_verification_method`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_field_followers_campaign_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_field_followers_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_field_followers_status_area`);
    await queryRunner.query(`DROP TABLE field_followers`);

    await queryRunner.query(`DROP INDEX IF EXISTS idx_frc_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_frc_active_live`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_follower_recruitment_campaigns_set_updated_at ON follower_recruitment_campaigns`,
    );
    await queryRunner.query(`DROP TABLE follower_recruitment_campaigns`);

    await queryRunner.query(`
      DELETE FROM application_display_states
      WHERE domain_code IN ('FIELD_FOLLOWER_STATUS', 'RECRUITMENT_CAMPAIGN_STATE')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE follower_recruitment_campaigns (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL
          CONSTRAINT chk_frc_name_not_blank CHECK (btrim(name) <> ''),
        description TEXT NULL,
        public_code TEXT NOT NULL
          CONSTRAINT uq_frc_public_code UNIQUE
          CONSTRAINT chk_frc_public_code_format CHECK (public_code ~ '^[A-Za-z0-9_-]{12,64}$'),
        data_scope JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT true,
        status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
          CONSTRAINT chk_frc_status CHECK (status IN ('ACTIVE', 'LOCKED', 'EXPIRED', 'SCHEDULED')),
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
      INSERT INTO follower_recruitment_campaigns (
        id, name, description, public_code, data_scope, is_active, status,
        opens_at, closes_at, view_count, created_at, created_by, updated_at,
        updated_by, deleted_at, deleted_by
      )
      SELECT
        id, name, description, public_code, data_scope, is_active, status,
        opens_at, closes_at, view_count, created_at, created_by, updated_at,
        updated_by, deleted_at, deleted_by
      FROM retired_follower_recruitment_campaigns_20260814
    `);
    await queryRunner.query(`
      SELECT setval(
        pg_get_serial_sequence('follower_recruitment_campaigns', 'id'),
        COALESCE(MAX(id), 1),
        MAX(id) IS NOT NULL
      )
      FROM follower_recruitment_campaigns
    `);
    await queryRunner.query(`
      CREATE INDEX idx_frc_active_live
        ON follower_recruitment_campaigns (is_active)
        WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_frc_created_at
        ON follower_recruitment_campaigns (created_at DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE field_followers (
        id BIGSERIAL PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        phone VARCHAR(20) NOT NULL,
        email TEXT NULL,
        gender VARCHAR(20) NULL,
        sub_district TEXT NULL,
        district TEXT NULL,
        province TEXT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'APPLIED'
          CONSTRAINT chk_field_followers_status
          CHECK (status IN ('APPLIED', 'VERIFIED', 'ACTIVE', 'SUSPENDED')),
        trust_level VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
        applied_via VARCHAR(20) NOT NULL DEFAULT 'PUBLIC_FORM',
        verification_method VARCHAR(16) NOT NULL DEFAULT 'PENDING'
          CONSTRAINT chk_field_followers_verification_method
          CHECK (verification_method IN ('THAID', 'ID_CARD_PHOTO', 'PENDING')),
        thaid_person_ref TEXT NULL,
        id_card_photo_filename TEXT NULL,
        id_card_photo_uploaded_at TIMESTAMPTZ NULL,
        campaign_id BIGINT NULL
          CONSTRAINT fk_field_followers_campaign
          REFERENCES follower_recruitment_campaigns(id) ON DELETE RESTRICT ON UPDATE CASCADE,
        reviewed_by_user_id INTEGER NULL
          CONSTRAINT fk_field_followers_reviewed_by
          REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        reviewed_at TIMESTAMPTZ NULL,
        verified_by_user_id INTEGER NULL
          CONSTRAINT fk_field_followers_verified_by
          REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        verified_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      INSERT INTO field_followers (
        id, first_name, last_name, phone, email, gender, sub_district,
        district, province, status, trust_level, applied_via,
        verification_method, thaid_person_ref, id_card_photo_filename,
        id_card_photo_uploaded_at, campaign_id, reviewed_by_user_id,
        reviewed_at, verified_by_user_id, verified_at, created_at, updated_at
      )
      SELECT
        id, first_name, last_name, phone, email, gender, sub_district,
        district, province, status, trust_level, applied_via,
        verification_method, thaid_person_ref, id_card_photo_filename,
        id_card_photo_uploaded_at, campaign_id, reviewed_by_user_id,
        reviewed_at, verified_by_user_id, verified_at, created_at, updated_at
      FROM retired_field_followers_20260814
    `);
    await queryRunner.query(`
      SELECT setval(
        pg_get_serial_sequence('field_followers', 'id'),
        COALESCE(MAX(id), 1),
        MAX(id) IS NOT NULL
      )
      FROM field_followers
    `);
    await queryRunner.query(`
      CREATE INDEX idx_field_followers_status_area
        ON field_followers (status, province, district, sub_district)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_field_followers_created_at
        ON field_followers (created_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_field_followers_campaign_id
        ON field_followers (campaign_id)
        WHERE campaign_id IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX idx_field_followers_verification_method
        ON field_followers (verification_method)
    `);

    await queryRunner.query(`
      ALTER TABLE task_links
        ADD COLUMN source_field_follower_id BIGINT NULL,
        ADD CONSTRAINT fk_task_links_field_follower
          FOREIGN KEY (source_field_follower_id)
          REFERENCES field_followers(id)
          ON DELETE SET NULL ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      UPDATE task_links link
      SET source_field_follower_id = backup.source_field_follower_id
      FROM retired_task_link_field_follower_refs_20260814 backup
      WHERE backup.task_link_id = link.id
    `);
    await queryRunner.query(`
      CREATE INDEX idx_task_links_source_field_follower
        ON task_links (source_field_follower_id)
        WHERE source_field_follower_id IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE follower_recruitment_campaign_targets (
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
      INSERT INTO follower_recruitment_campaign_targets (
        id, campaign_id, case_id, status, assigned_follower_id,
        assigned_task_link_id, assigned_at, assigned_by, created_at,
        created_by, updated_at, updated_by, deleted_at, deleted_by
      )
      SELECT
        id, campaign_id, case_id, status, assigned_follower_id,
        assigned_task_link_id, assigned_at, assigned_by, created_at,
        created_by, updated_at, updated_by, deleted_at, deleted_by
      FROM retired_follower_recruitment_campaign_targets_20260814
    `);
    await queryRunner.query(`
      SELECT setval(
        pg_get_serial_sequence('follower_recruitment_campaign_targets', 'id'),
        COALESCE(MAX(id), 1),
        MAX(id) IS NOT NULL
      )
      FROM follower_recruitment_campaign_targets
    `);
    await queryRunner.query(`
      CREATE INDEX idx_frct_campaign_status
        ON follower_recruitment_campaign_targets (campaign_id, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_frct_follower
        ON follower_recruitment_campaign_targets (assigned_follower_id)
        WHERE assigned_follower_id IS NOT NULL
    `);

    await queryRunner.query(`
      INSERT INTO application_display_states (
        domain_code, code, label_th, badge_variant, summary_tone, sort_order,
        is_active, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by
      )
      SELECT
        domain_code, code, label_th, badge_variant, summary_tone, sort_order,
        is_active, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by
      FROM retired_field_follower_display_states_20260814
      ON CONFLICT (domain_code, code) DO UPDATE SET
        label_th = EXCLUDED.label_th,
        badge_variant = EXCLUDED.badge_variant,
        summary_tone = EXCLUDED.summary_tone,
        sort_order = EXCLUDED.sort_order,
        is_active = EXCLUDED.is_active,
        updated_at = EXCLUDED.updated_at,
        updated_by = EXCLUDED.updated_by,
        deleted_at = EXCLUDED.deleted_at,
        deleted_by = EXCLUDED.deleted_by
    `);

    await queryRunner.query(`DROP TABLE retired_follower_recruitment_campaign_targets_20260814`);
    await queryRunner.query(`DROP TABLE retired_field_followers_20260814`);
    await queryRunner.query(`DROP TABLE retired_follower_recruitment_campaigns_20260814`);
    await queryRunner.query(`DROP TABLE retired_task_link_field_follower_refs_20260814`);
    await queryRunner.query(`DROP TABLE retired_field_follower_display_states_20260814`);
  }
}
