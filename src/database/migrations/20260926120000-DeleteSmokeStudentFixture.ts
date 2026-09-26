import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Delete the smoke-test student that leaked into real databases.
 *
 * `scripts/smoke-account-lifecycle.js` (2026-07-01) created a student with
 * `PersonID_Onec = 'SMOKE-STUDENT-ACCT-001'` and grade code 6, which is not a
 * grade the system knows. The row was captured in the July baseline dump and
 * restored with it, later picked up a realistic name, and sat without a term or
 * classroom ever since. It was never on a roster, a case or a notification.
 * Production's four rows were archived to
 * `data/backups/smoke-student-fixture-production-20260926.json.gz` first.
 *
 * Matches on the `SMOKE-` identifier only, so a real student can never qualify.
 */
export class DeleteSmokeStudentFixture20260926120000 implements MigrationInterface {
  name = 'DeleteSmokeStudentFixture20260926120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TEMP TABLE smoke_student_terms ON COMMIT DROP AS
      SELECT student_uuid, person_uuid FROM student_term WHERE "PersonID_Onec" LIKE 'SMOKE-%'
    `);
    for (const table of [
      'attendance_session_roster',
      'cases',
      'pii_export_request_students',
      'student_disabilities',
      'student_term_disadvantages',
      'student_home_geocode_cache',
      'student_risk_profiles',
    ]) {
      await queryRunner.query(
        `DELETE FROM ${table} WHERE student_uuid IN (SELECT student_uuid FROM smoke_student_terms)`,
      );
    }
    await queryRunner.query(
      `DELETE FROM student_term WHERE student_uuid IN (SELECT student_uuid FROM smoke_student_terms)`,
    );

    // the person goes too, unless a real enrollment still points at it
    await queryRunner.query(`
      CREATE TEMP TABLE smoke_student_persons ON COMMIT DROP AS
      SELECT DISTINCT person_uuid FROM smoke_student_terms s
      WHERE person_uuid IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM student_term t WHERE t.person_uuid = s.person_uuid)
    `);
    for (const [table, column] of [
      ['classroom_student_comments', 'person_uuid'],
      ['notifications', 'student_person_uuid'],
      ['student_exit_events', 'person_uuid'],
      ['student_guardian', 'person_uuid'],
      ['student_person_contact', 'person_uuid'],
      ['student_person_identifier', 'person_uuid'],
    ]) {
      await queryRunner.query(
        `DELETE FROM ${table} WHERE ${column} IN (SELECT person_uuid FROM smoke_student_persons)`,
      );
    }
    await queryRunner.query(`
      UPDATE student_import_quarantine_rows SET resolved_person_uuid = NULL
      WHERE resolved_person_uuid IN (SELECT person_uuid FROM smoke_student_persons)
    `);
    await queryRunner.query(`
      UPDATE student_person SET merged_into = NULL
      WHERE merged_into IN (SELECT person_uuid FROM smoke_student_persons)
    `);
    await queryRunner.query(
      `DELETE FROM student_person WHERE person_uuid IN (SELECT person_uuid FROM smoke_student_persons)`,
    );
  }

  public down(): Promise<void> {
    return Promise.reject(
      new Error(
        'DeleteSmokeStudentFixture20260926120000 is intentionally irreversible: it removed test data. ' +
          'The production rows are in data/backups/smoke-student-fixture-production-20260926.json.gz.',
      ),
    );
  }
}
