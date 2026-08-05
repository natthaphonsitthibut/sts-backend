import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStudentIdToCases20260612000000 implements MigrationInterface {
  name = 'AddStudentIdToCases20260612000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE cases
      ADD COLUMN IF NOT EXISTS student_id TEXT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE cases
      DROP COLUMN IF EXISTS student_id
    `);
  }
}
