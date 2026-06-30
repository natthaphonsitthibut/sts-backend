import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountLifecycleColumns20260630130000 implements MigrationInterface {
  name = 'AddAccountLifecycleColumns20260630130000';

  // Soft-deactivate / reactivate metadata for accounts of ANY role (not just
  // students). Canonicalizes users.status to ACTIVE/DISABLED and records who/why/
  // when on deactivate. PENDING_FIRST_LOGIN / TEMP_PASSWORD_EXPIRED stay derived.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS deactivated_by INTEGER,
        ADD COLUMN IF NOT EXISTS deactivation_reason_code VARCHAR(32),
        ADD COLUMN IF NOT EXISTS deactivation_note VARCHAR(255)
    `);

    // deactivated_by -> users(id), matching the existing *_by audit-column pattern.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_deactivated_by') THEN
          ALTER TABLE users
            ADD CONSTRAINT fk_users_deactivated_by
            FOREIGN KEY (deactivated_by) REFERENCES users(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Bounded reason taxonomy (nullable while ACTIVE).
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_deactivation_reason_code') THEN
          ALTER TABLE users
            ADD CONSTRAINT chk_users_deactivation_reason_code
            CHECK (
              deactivation_reason_code IS NULL
              OR deactivation_reason_code IN ('STAFF_LEFT','TRANSFERRED','DUPLICATE','SECURITY','OTHER')
            );
        END IF;
      END $$;
    `);

    // Canonicalize any legacy/junk status (e.g. INACTIVE, *_SMOKE) before locking
    // the domain, so VALIDATE succeeds on every environment.
    await queryRunner.query(
      `UPDATE users SET status = 'DISABLED' WHERE status NOT IN ('ACTIVE','DISABLED')`,
    );
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_status') THEN
          ALTER TABLE users
            ADD CONSTRAINT chk_users_status CHECK (status IN ('ACTIVE','DISABLED')) NOT VALID;
          ALTER TABLE users VALIDATE CONSTRAINT chk_users_status;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_status`);
    await queryRunner.query(
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_deactivation_reason_code`,
    );
    await queryRunner.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_deactivated_by`);
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN IF EXISTS deactivation_note,
        DROP COLUMN IF EXISTS deactivation_reason_code,
        DROP COLUMN IF EXISTS deactivated_by,
        DROP COLUMN IF EXISTS deactivated_at
    `);
  }
}
