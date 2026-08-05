import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

/**
 * EXPAND — canonical student contact channels, independent of login accounts.
 *
 * Existing users contact columns stay in place for non-student account profiles
 * and rollback compatibility. Student reads/writes move to this person-level row.
 */
export class AddStudentPersonContact20260718100000 implements MigrationInterface {
  name = 'AddStudentPersonContact20260718100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE student_person_contact (
        person_uuid UUID PRIMARY KEY,
        phone VARCHAR(20),
        email VARCHAR(254),
        line_id VARCHAR(64),
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT fk_student_person_contact_person
          FOREIGN KEY (person_uuid) REFERENCES student_person(person_uuid)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT chk_student_person_contact_phone
          CHECK (phone IS NULL OR btrim(phone) <> ''),
        CONSTRAINT chk_student_person_contact_email
          CHECK (email IS NULL OR btrim(email) <> ''),
        CONSTRAINT chk_student_person_contact_line_id
          CHECK (line_id IS NULL OR btrim(line_id) <> '')
      )
    `);
    await queryRunner.query(auditUpdatedAtTriggerSql('student_person_contact'));
    await queryRunner.query(`
      INSERT INTO student_person_contact (
        person_uuid, phone, email, line_id, created_by, updated_by
      )
      SELECT u.person_uuid, u.phone, u.email, u.line_id, u.id, u.id
      FROM users u
      WHERE u.role = 'STUDENT'
        AND u.status = 'ACTIVE'
        AND u.person_uuid IS NOT NULL
        AND (u.phone IS NOT NULL OR u.email IS NOT NULL OR u.line_id IS NOT NULL)
      ON CONFLICT (person_uuid) DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS student_person_contact`);
  }
}
