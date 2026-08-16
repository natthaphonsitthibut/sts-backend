import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `risk_tier` was the only status family in the system still expressed as a
 * CHECK list, with its Thai labels hardcoded in the frontend — the exact shape
 * `task-no-hardcode-configuration-contract` exists to prevent. It becomes a
 * lookup table like every other status family, so the wording can change
 * without a deploy and the badge treatment comes from data.
 *
 * `risk_severity` stays: it is derived from the tier and duplicates it 1:1, but
 * it is also the materialised sort key behind
 * `idx_student_risk_profiles_severity_score` on ~6k rows. `sort_order` here is
 * the source of truth for the ordering; the column keeps the dashboard from
 * joining the catalogue on every page. Dropping it is a separate change with
 * its own index and query work.
 */
export class AddStudentRiskTierCatalog20260819090000 implements MigrationInterface {
  name = 'AddStudentRiskTierCatalog20260819090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE student_risk_tiers (
        code VARCHAR(24) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        badge_variant VARCHAR(16) NOT NULL,
        summary_tone VARCHAR(16),
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_student_risk_tiers_label CHECK (length(btrim(label_th)) > 0),
        CONSTRAINT chk_student_risk_tiers_sort_order CHECK (sort_order >= 0)
      )
    `);
    // `sort_order` mirrors the severity the profile table materialises, so the
    // two can never drift apart silently.
    await queryRunner.query(`
      INSERT INTO student_risk_tiers (code, label_th, badge_variant, summary_tone, sort_order)
      VALUES
        ('NORMAL', 'ปกติ', 'secondary', 'default', 0),
        ('WATCH', 'เฝ้าระวัง', 'warning', 'warning', 1),
        ('HIGH', 'เสี่ยง', 'destructive', 'danger', 2)
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_student_risk_tiers_set_updated_at
      BEFORE UPDATE ON student_risk_tiers
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
        DROP CONSTRAINT IF EXISTS chk_student_risk_profiles_tier
    `);
    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
        ADD CONSTRAINT fk_student_risk_profiles_tier
        FOREIGN KEY (risk_tier) REFERENCES student_risk_tiers(code)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
        DROP CONSTRAINT IF EXISTS fk_student_risk_profiles_tier
    `);
    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
        ADD CONSTRAINT chk_student_risk_profiles_tier
        CHECK (risk_tier IN ('HIGH', 'WATCH', 'NORMAL'))
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_student_risk_tiers_set_updated_at ON student_risk_tiers`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS student_risk_tiers`);
  }
}
