import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The risk ladder was written twice: once as `risk_tier` and again as
 * `risk_severity`, both from the same CASE in the recalculation SQL. Two copies
 * of one rule can drift, and nothing in the schema said they must agree.
 *
 * `risk_severity` is not deleted — it is the materialised sort key behind
 * `idx_student_risk_profiles_sort (risk_severity DESC, risk_score DESC, ...)`,
 * and the dashboard reads it on every page. Dropping it would force a join to
 * order rows and make that index impossible, trading correctness we can get for
 * free against read performance we would lose.
 *
 * Instead the catalogue becomes the single source of the ordering:
 * `student_risk_tiers.sort_order` is what the recalculation writes into
 * `risk_severity`, and a composite foreign key makes any other pairing
 * unstorable. The column stays fast to read and can no longer disagree with the
 * tier it belongs to.
 */
export class DeriveRiskSeverityFromTierCatalog20260819120000 implements MigrationInterface {
  name = 'DeriveRiskSeverityFromTierCatalog20260819120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_risk_tiers
        ADD CONSTRAINT uq_student_risk_tiers_code_sort_order UNIQUE (code, sort_order)
    `);

    // Align any row whose severity disagrees with its tier before the pair is
    // locked, so the constraint cannot fail on legacy data.
    await queryRunner.query(`
      UPDATE student_risk_profiles profile
      SET risk_severity = tier.sort_order
      FROM student_risk_tiers tier
      WHERE tier.code = profile.risk_tier
        AND profile.risk_severity IS DISTINCT FROM tier.sort_order
    `);

    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
        ADD CONSTRAINT fk_student_risk_profiles_tier_severity
        FOREIGN KEY (risk_tier, risk_severity)
        REFERENCES student_risk_tiers(code, sort_order)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE student_risk_profiles
        DROP CONSTRAINT IF EXISTS fk_student_risk_profiles_tier_severity
    `);
    await queryRunner.query(`
      ALTER TABLE student_risk_tiers
        DROP CONSTRAINT IF EXISTS uq_student_risk_tiers_code_sort_order
    `);
  }
}
