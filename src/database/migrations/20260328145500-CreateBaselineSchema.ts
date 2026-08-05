import type { MigrationInterface, QueryRunner } from 'typeorm';
import { MIGRATION_BASELINE_202603_SQL } from '../migration-baseline-202603';

export class CreateBaselineSchema20260328145500 implements MigrationInterface {
  name = 'CreateBaselineSchema20260328145500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(MIGRATION_BASELINE_202603_SQL);
  }

  public async down(): Promise<void> {
    // Baseline migration is intentionally non-destructive during transition.
  }
}
