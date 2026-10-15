import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A case belongs to the student, not to one term's enrollment (owner,
 * 2026-10-15): เสี่ยง and ส่งต่อ stay open into the next term until the case is
 * closed. `cases.student_uuid` stays the enrollment the case was opened in;
 * `cases.person_uuid` is the student it follows across terms.
 *
 * - `person_uuid` is filled from `student_term` by a trigger, so every insert
 *   path (service, automation, fixtures) gets it without restating it.
 * - A composite FK `(student_uuid, person_uuid) -> student_term` keeps the two
 *   from ever disagreeing, and cascades an identity merge that re-points an
 *   enrollment to another person.
 * - "One active case per student" moves from the enrollment to the person, so
 *   a new term cannot open a second case beside the one carried over.
 *
 * Refuses to run when a case cannot be tied to a person, or when one person
 * already holds two active cases, rather than guessing which one wins.
 */
const ACTIVE_STATUSES_SQL = `'OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND',
  'AWAITING_REFERRAL', 'AWAITING_REFERRAL_OUTCOME', 'REFERRAL_NOT_SUCCEEDED'`;

export class AddCasePersonUuid20261015110000 implements MigrationInterface {
  name = 'AddCasePersonUuid20261015110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $guard$
      DECLARE unlinked int;
      BEGIN
        SELECT COUNT(*) INTO unlinked
        FROM cases c
        LEFT JOIN student_term st ON st.student_uuid = c.student_uuid
        WHERE st.person_uuid IS NULL;
        IF unlinked > 0 THEN
          RAISE EXCEPTION 'AddCasePersonUuid: % case(s) have no student enrollment to take a person from', unlinked;
        END IF;
      END $guard$;
    `);

    await queryRunner.query(`ALTER TABLE cases ADD COLUMN person_uuid UUID`);
    await queryRunner.query(`
      UPDATE cases c
      SET person_uuid = st.person_uuid
      FROM student_term st
      WHERE st.student_uuid = c.student_uuid
    `);
    await queryRunner.query(`ALTER TABLE cases ALTER COLUMN student_uuid SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE cases ALTER COLUMN person_uuid SET NOT NULL`);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_student_term_student_person
        ON student_term (student_uuid, person_uuid)
    `);
    await queryRunner.query(`
      ALTER TABLE cases
        ADD CONSTRAINT fk_cases_person_uuid
        FOREIGN KEY (person_uuid) REFERENCES student_person(person_uuid)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE cases
        ADD CONSTRAINT fk_cases_enrollment_person
        FOREIGN KEY (student_uuid, person_uuid)
        REFERENCES student_term (student_uuid, person_uuid)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);

    await queryRunner.query(`
      CREATE FUNCTION cases_fill_person_uuid() RETURNS trigger
      LANGUAGE plpgsql AS $fn$
      BEGIN
        SELECT st.person_uuid INTO NEW.person_uuid
        FROM student_term st
        WHERE st.student_uuid = NEW.student_uuid;
        RETURN NEW;
      END
      $fn$
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_cases_fill_person_uuid
        BEFORE INSERT OR UPDATE OF student_uuid ON cases
        FOR EACH ROW EXECUTE FUNCTION cases_fill_person_uuid()
    `);

    await queryRunner.query(`
      DO $guard$
      DECLARE doubled int;
      BEGIN
        SELECT COUNT(*) INTO doubled FROM (
          SELECT person_uuid FROM cases
          WHERE deleted_at IS NULL AND status IN (${ACTIVE_STATUSES_SQL})
          GROUP BY person_uuid HAVING COUNT(*) > 1
        ) twice;
        IF doubled > 0 THEN
          RAISE EXCEPTION 'AddCasePersonUuid: % student(s) hold more than one active case', doubled;
        END IF;
      END $guard$;
    `);
    await queryRunner.query(`DROP INDEX uq_cases_active_student_uuid`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_cases_active_person_uuid
        ON cases (person_uuid)
        WHERE deleted_at IS NULL AND status IN (${ACTIVE_STATUSES_SQL})
    `);
    await queryRunner.query(`
      CREATE INDEX idx_cases_person_uuid
        ON cases (person_uuid, created_at DESC, id DESC)
        WHERE deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX idx_cases_person_uuid`);
    await queryRunner.query(`DROP INDEX uq_cases_active_person_uuid`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_cases_active_student_uuid
        ON cases (student_uuid)
        WHERE student_uuid IS NOT NULL AND deleted_at IS NULL
          AND status IN (${ACTIVE_STATUSES_SQL})
    `);
    await queryRunner.query(`DROP TRIGGER trg_cases_fill_person_uuid ON cases`);
    await queryRunner.query(`DROP FUNCTION cases_fill_person_uuid()`);
    await queryRunner.query(`ALTER TABLE cases DROP CONSTRAINT fk_cases_enrollment_person`);
    await queryRunner.query(`ALTER TABLE cases DROP CONSTRAINT fk_cases_person_uuid`);
    await queryRunner.query(`DROP INDEX uq_student_term_student_person`);
    await queryRunner.query(`ALTER TABLE cases ALTER COLUMN student_uuid DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE cases DROP COLUMN person_uuid`);
  }
}
