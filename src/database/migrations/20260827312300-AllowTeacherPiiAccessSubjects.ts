import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Allows the shared immutable PII log to identify teacher reveal events clearly. */
export class AllowTeacherPiiAccessSubjects20260827312300 implements MigrationInterface {
  name = 'AllowTeacherPiiAccessSubjects20260827312300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        DROP CONSTRAINT IF EXISTS chk_pii_access_events_subject_type,
        ADD CONSTRAINT chk_pii_access_events_subject_type
          CHECK (subject_type IN ('STUDENT', 'USER', 'TEACHER')) NOT VALID
    `);
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        VALIDATE CONSTRAINT chk_pii_access_events_subject_type
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pii_access_events WHERE subject_type = 'TEACHER') THEN
          RAISE EXCEPTION 'Cannot remove TEACHER PII subject support while immutable audit rows exist';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        DROP CONSTRAINT IF EXISTS chk_pii_access_events_subject_type,
        ADD CONSTRAINT chk_pii_access_events_subject_type
          CHECK (subject_type IN ('STUDENT', 'USER')) NOT VALID
    `);
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        VALIDATE CONSTRAINT chk_pii_access_events_subject_type
    `);
  }
}
