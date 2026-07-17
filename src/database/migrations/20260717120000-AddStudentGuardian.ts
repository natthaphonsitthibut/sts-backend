import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * EXPAND — guardian contact channels for a student (person-level, spans terms).
 *
 * Stores name + relation + contact channels only (phone / email / LINE).
 * Deliberately NO national id: data minimization — no flow consumes it. If a
 * guardian identity flow ever appears, extend via the student_person_identifier
 * pattern instead of widening this table.
 *
 * relation is FATHER / MOTHER / GUARDIAN; relation_note says what a GUARDIAN
 * actually is (grandmother, uncle, ...) and is CHECK-limited to that relation.
 * The student's own contact channels live in student_person_contact — not here.
 */
export class AddStudentGuardian20260717120000 implements MigrationInterface {
  name = 'AddStudentGuardian20260717120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS student_guardian (
        id BIGSERIAL PRIMARY KEY,
        person_uuid UUID NOT NULL REFERENCES student_person(person_uuid)
          ON DELETE CASCADE ON UPDATE CASCADE,
        relation VARCHAR(16) NOT NULL CHECK (relation IN ('FATHER', 'MOTHER', 'GUARDIAN')),
        relation_note VARCHAR(100) CHECK (relation_note IS NULL OR relation = 'GUARDIAN'),
        full_name VARCHAR(200) NOT NULL CHECK (btrim(full_name) <> ''),
        phone VARCHAR(20) CHECK (phone IS NULL OR btrim(phone) <> ''),
        email VARCHAR(254) CHECK (email IS NULL OR btrim(email) <> ''),
        line_id VARCHAR(64) CHECK (line_id IS NULL OR btrim(line_id) <> ''),
        is_primary BOOLEAN NOT NULL DEFAULT FALSE,
        ${AUDIT_COLUMNS_SQL}
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('student_guardian'));
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_student_guardian_person
        ON student_guardian (person_uuid)
    `);
    // One primary contact per student among live rows.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_student_guardian_primary
        ON student_guardian (person_uuid)
        WHERE is_primary AND deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS student_guardian`);
  }
}
