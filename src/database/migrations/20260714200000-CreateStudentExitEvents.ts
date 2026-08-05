import type { MigrationInterface, QueryRunner } from 'typeorm';
import { AUDIT_COLUMNS_SQL, auditUpdatedAtTriggerSql } from '../bootstrap-sql';

interface CountRow extends Record<string, unknown> {
  source_count: number | string;
  target_count: number | string;
  missing_person: number | string;
  missing_school: number | string;
  duplicate_person: number | string;
  source_checksum: string | null;
  target_checksum: string | null;
}

const SOURCE_SYSTEM = 'ONEC_LEGACY_DROPOUT';

export class CreateStudentExitEvents20260714200000 implements MigrationInterface {
  name = 'CreateStudentExitEvents20260714200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await queryRunner.query(`
      CREATE TABLE student_exit_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        person_uuid UUID NOT NULL,
        school_id INTEGER NOT NULL,
        source_student_uuid UUID NOT NULL,
        source_system VARCHAR(32) NOT NULL,
        source_record_key_sha256 CHAR(64) NOT NULL,
        exit_reason_source_code VARCHAR(64),
        academic_year INTEGER,
        last_enrolled_academic_year INTEGER,
        last_grade_level_id INTEGER,
        last_room_number INTEGER,
        last_gpax REAL,
        note TEXT,
        effective_at DATE,
        source_record_snapshot JSONB NOT NULL,
        ${AUDIT_COLUMNS_SQL},
        CONSTRAINT uq_student_exit_events_source_student UNIQUE (source_student_uuid),
        CONSTRAINT uq_student_exit_events_source_record
          UNIQUE (source_system, source_record_key_sha256),
        CONSTRAINT fk_student_exit_events_person
          FOREIGN KEY (person_uuid) REFERENCES student_person(person_uuid)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_exit_events_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_student_exit_events_grade
          FOREIGN KEY (last_grade_level_id) REFERENCES grade_levels(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_student_exit_events_source_system
          CHECK (length(trim(source_system)) > 0),
        CONSTRAINT chk_student_exit_events_source_record_key_sha256
          CHECK (source_record_key_sha256 ~ '^[0-9a-f]{64}$'),
        CONSTRAINT chk_student_exit_events_source_snapshot
          CHECK (jsonb_typeof(source_record_snapshot) = 'object')
      );
      ${auditUpdatedAtTriggerSql('student_exit_events')}

      CREATE INDEX idx_student_exit_events_person_year
        ON student_exit_events (person_uuid, academic_year DESC);
      CREATE INDEX idx_student_exit_events_school_year
        ON student_exit_events (school_id, academic_year DESC);
    `);

    const [preflight] = (await queryRunner.query(`
      SELECT
        count(*)::int AS source_count,
        count(*) FILTER (
          WHERE dropout.person_uuid IS NULL OR person.person_uuid IS NULL
        )::int AS missing_person,
        count(*) FILTER (
          WHERE dropout."SchoolID_Onec" IS NULL OR school.id IS NULL
        )::int AS missing_school,
        (
          SELECT count(*)::int
          FROM (
            SELECT person_uuid
            FROM student_dropouts
            GROUP BY person_uuid
            HAVING count(*) > 1
          ) duplicate_people
        ) AS duplicate_person
      FROM student_dropouts dropout
      LEFT JOIN student_person person ON person.person_uuid = dropout.person_uuid
      LEFT JOIN schools school ON school.id = dropout."SchoolID_Onec"
    `)) as CountRow[];

    if (
      Number(preflight.missing_person) > 0 ||
      Number(preflight.missing_school) > 0 ||
      Number(preflight.duplicate_person) > 0
    ) {
      throw new Error(
        `student_dropouts preflight failed: missing_person=${preflight.missing_person}, ` +
          `missing_school=${preflight.missing_school}, duplicate_person=${preflight.duplicate_person}`,
      );
    }

    await queryRunner.query(
      `
        INSERT INTO student_exit_events (
          person_uuid,
          school_id,
          source_student_uuid,
          source_system,
          source_record_key_sha256,
          exit_reason_source_code,
          academic_year,
          last_enrolled_academic_year,
          last_grade_level_id,
          last_room_number,
          last_gpax,
          note,
          effective_at,
          source_record_snapshot,
          created_at,
          created_by,
          updated_at,
          updated_by,
          deleted_at,
          deleted_by
        )
        SELECT
          dropout.person_uuid,
          dropout."SchoolID_Onec",
          dropout.student_uuid,
          $1,
          encode(digest(dropout."PersonID_Onec", 'sha256'), 'hex'),
          NULLIF(trim(dropout."StatusCodeCause_Onec"), ''),
          dropout."ACADYEAR",
          dropout."AcademicYearPresent_Onec",
          dropout."GradeLevelID_Onec",
          dropout."RoomID_Onec",
          dropout."GPAX_Onec",
          dropout."Remark_Onec",
          NULL,
          to_jsonb(dropout),
          dropout.created_at,
          dropout.created_by,
          dropout.updated_at,
          dropout.updated_by,
          dropout.deleted_at,
          dropout.deleted_by
        FROM student_dropouts dropout
      `,
      [SOURCE_SYSTEM],
    );

    const [reconciliation] = (await queryRunner.query(
      `
        SELECT
          (SELECT count(*)::int FROM student_dropouts) AS source_count,
          count(*)::int AS target_count,
          (
            SELECT md5(COALESCE(string_agg(source_record::text, '' ORDER BY source_key), ''))
            FROM (
              SELECT "PersonID_Onec" AS source_key, to_jsonb(dropout) AS source_record
              FROM student_dropouts dropout
            ) source_rows
          ) AS source_checksum,
          md5(COALESCE(string_agg(
            source_record_snapshot::text,
            '' ORDER BY source_record_snapshot->>'PersonID_Onec'
          ), ''))
            AS target_checksum
        FROM student_exit_events
        WHERE source_system = $1
      `,
      [SOURCE_SYSTEM],
    )) as CountRow[];

    if (
      Number(reconciliation.source_count) !== Number(reconciliation.target_count) ||
      reconciliation.source_checksum !== reconciliation.target_checksum
    ) {
      throw new Error(
        `student exit event reconciliation failed: source=${reconciliation.source_count}, ` +
          `target=${reconciliation.target_count}, checksum_match=${
            reconciliation.source_checksum === reconciliation.target_checksum
          }`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_student_exit_events_set_updated_at ON student_exit_events;
      DROP TABLE student_exit_events;
    `);
  }
}
