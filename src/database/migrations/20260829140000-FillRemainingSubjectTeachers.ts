import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Kept as a no-op migration so environments that already recorded this name
 * retain migration parity. The former implementation assigned arbitrary active
 * teachers to unstaffed subjects. Nothing in the source data supported those
 * assignments, so a fresh database now leaves them unstaffed for an authorized
 * user to choose explicitly.
 *
 * Existing environments that ran the former SQL cannot be cleaned
 * automatically: those rows carry no provenance that distinguishes a guessed
 * assignment from a real choice made later. They must be reviewed or rebuilt
 * from trusted source data rather than deleted by another guess.
 */
export class FillRemainingSubjectTeachers20260829140000 implements MigrationInterface {
  name = 'FillRemainingSubjectTeachers20260829140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SELECT 1`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SELECT 1`);
  }
}
