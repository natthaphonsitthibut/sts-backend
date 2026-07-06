import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFieldFollowers20260706200000 implements MigrationInterface {
  name = 'AddFieldFollowers20260706200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS field_followers (
        id BIGSERIAL PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        phone VARCHAR(20) NOT NULL,
        sub_district TEXT NULL,
        district TEXT NULL,
        province TEXT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'APPLIED'
          CONSTRAINT chk_field_followers_status
          CHECK (status IN ('APPLIED', 'VERIFIED', 'ACTIVE', 'SUSPENDED')),
        trust_level VARCHAR(20) NOT NULL DEFAULT 'STANDARD',
        applied_via VARCHAR(20) NOT NULL DEFAULT 'PUBLIC_FORM',
        reviewed_by_user_id INTEGER NULL
          CONSTRAINT fk_field_followers_reviewed_by
          REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        reviewed_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_field_followers_status_area
        ON field_followers (status, province, district, sub_district)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_field_followers_created_at
        ON field_followers (created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_field_followers_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_field_followers_status_area`);
    await queryRunner.query(`DROP TABLE IF EXISTS field_followers`);
  }
}
