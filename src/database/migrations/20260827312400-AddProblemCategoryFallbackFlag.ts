import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Keeps the catch-all problem category last without encoding its code in runtime queries. */
export class AddProblemCategoryFallbackFlag20260827312400 implements MigrationInterface {
  name = 'AddProblemCategoryFallbackFlag20260827312400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE follow_up_problem_categories
        ADD COLUMN is_fallback BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await queryRunner.query(`
      UPDATE follow_up_problem_categories
      SET is_fallback = TRUE
      WHERE code = 'OTHER'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_follow_up_problem_categories_active_fallback
      ON follow_up_problem_categories (is_fallback)
      WHERE is_fallback = TRUE AND is_active = TRUE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS uq_follow_up_problem_categories_active_fallback
    `);
    await queryRunner.query(`
      ALTER TABLE follow_up_problem_categories
        DROP COLUMN is_fallback
    `);
  }
}
