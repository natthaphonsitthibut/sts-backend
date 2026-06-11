import type { MigrationInterface, QueryRunner } from 'typeorm';
import { runDatabaseBootstrap } from '../bootstrap-sql';

export class CreateBaselineSchema20260328145500 implements MigrationInterface {
  name = 'CreateBaselineSchema20260328145500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await runDatabaseBootstrap(queryRunner);
  }

  public async down(): Promise<void> {
    // Baseline migration is intentionally non-destructive during transition.
  }
}
