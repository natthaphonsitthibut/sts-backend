import type { MigrationInterface, QueryRunner } from 'typeorm';

export class GeneralizePiiAccessSubjects20260701170000 implements MigrationInterface {
  name = 'GeneralizePiiAccessSubjects20260701170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_pii_access_events_immutable ON pii_access_events`,
    );
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        ADD COLUMN IF NOT EXISTS subject_type VARCHAR(20),
        ADD COLUMN IF NOT EXISTS subject_ref TEXT
    `);
    await queryRunner.query(`
      UPDATE pii_access_events
      SET subject_type = 'STUDENT', subject_ref = subject_student_ref
      WHERE subject_type IS NULL OR subject_ref IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        ALTER COLUMN subject_type SET NOT NULL,
        ALTER COLUMN subject_ref SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        ADD CONSTRAINT chk_pii_access_events_subject_type
        CHECK (subject_type IN ('STUDENT', 'USER')) NOT VALID
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pii_access_events_typed_subject
        ON pii_access_events (subject_type, subject_ref, created_at)
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_pii_access_events_immutable
        BEFORE UPDATE OR DELETE ON pii_access_events
        FOR EACH ROW EXECUTE FUNCTION pii_access_events_block_mutation()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pii_access_events_typed_subject`);
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        DROP CONSTRAINT IF EXISTS chk_pii_access_events_subject_type,
        DROP COLUMN IF EXISTS subject_ref,
        DROP COLUMN IF EXISTS subject_type
    `);
  }
}
