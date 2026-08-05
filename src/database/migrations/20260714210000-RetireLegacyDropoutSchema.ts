import type { MigrationInterface, QueryRunner } from 'typeorm';
import { auditUpdatedAtTriggerSql } from '../bootstrap-sql';

interface CountRow extends Record<string, unknown> {
  count: number | string;
}

const SOURCE_SYSTEM = 'ONEC_LEGACY_DROPOUT';

export class RetireLegacyDropoutSchema20260714210000 implements MigrationInterface {
  name = 'RetireLegacyDropoutSchema20260714210000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [reasonCount] = (await queryRunner.query(
      `SELECT count(*)::int AS count FROM dropout_reasons`,
    )) as CountRow[];
    if (Number(reasonCount.count) > 0) {
      throw new Error(
        `Refusing to drop dropout_reasons with ${reasonCount.count} unmapped rows; ` +
          `map the catalog to a reviewed canonical reason catalog first`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE student_import_batches
        DROP CONSTRAINT chk_student_import_batches_target;
      UPDATE student_import_batches
      SET target = 'student_exit_events'
      WHERE target = 'student_dropouts';
      ALTER TABLE student_import_batches
        ADD CONSTRAINT chk_student_import_batches_target
          CHECK (target IN ('student_term', 'student_exit_events', 'school_teacher_membership'));

      DROP TABLE student_dropouts;
      DROP TABLE dropout_reasons;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE dropout_reasons (
        id SERIAL PRIMARY KEY,
        label TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
      ${auditUpdatedAtTriggerSql('dropout_reasons')}

      CREATE TABLE student_dropouts (
        "ProvinceNameThai_Onec" TEXT,
        "DistrictNameThai_Onec" TEXT,
        "SubDistrictNameThai_Onec" TEXT,
        "PersonID_Onec" TEXT PRIMARY KEY,
        "Fullname_Onec" TEXT,
        "Gender_Onec" TEXT,
        "NationalityName_Onec" TEXT,
        "BirthDate_Onec" TEXT,
        "HouseNumber_Onec" TEXT,
        "VillageNumber_Onec" TEXT,
        "Street_Onec" TEXT,
        "Soi_Onec" TEXT,
        "Trok_Onec" TEXT,
        "StatusCodeCause_Onec" TEXT,
        "Remark_Onec" TEXT,
        "SchoolName_Onec" TEXT,
        "GradeLevelID_Onec" INTEGER,
        "AcademicYearPresent_Onec" INTEGER,
        "DropoutTransferID_Onec" INTEGER,
        "ACADYEAR" INTEGER,
        "RoomID_Onec" INTEGER,
        "SchoolID_Onec" INTEGER,
        "GenderID_Onec" INTEGER,
        "GPAX_Onec" REAL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        student_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
        person_uuid UUID,
        CONSTRAINT uq_student_dropouts_student_uuid UNIQUE (student_uuid),
        CONSTRAINT fk_student_dropouts_person
          FOREIGN KEY (person_uuid) REFERENCES student_person(person_uuid)
          ON DELETE RESTRICT,
        CONSTRAINT fk_student_dropouts_school
          FOREIGN KEY ("SchoolID_Onec") REFERENCES schools(id)
          ON DELETE SET NULL
      );
      ${auditUpdatedAtTriggerSql('student_dropouts')}
      CREATE INDEX idx_student_dropouts_person_uuid ON student_dropouts (person_uuid);
    `);

    await queryRunner.query(
      `
        INSERT INTO student_dropouts (
          "ProvinceNameThai_Onec", "DistrictNameThai_Onec", "SubDistrictNameThai_Onec",
          "PersonID_Onec", "Fullname_Onec", "Gender_Onec", "NationalityName_Onec",
          "BirthDate_Onec", "HouseNumber_Onec", "VillageNumber_Onec", "Street_Onec",
          "Soi_Onec", "Trok_Onec", "StatusCodeCause_Onec", "Remark_Onec",
          "SchoolName_Onec", "GradeLevelID_Onec", "AcademicYearPresent_Onec",
          "DropoutTransferID_Onec", "ACADYEAR", "RoomID_Onec", "SchoolID_Onec",
          "GenderID_Onec", "GPAX_Onec", created_at, updated_at, created_by, updated_by,
          deleted_at, deleted_by, student_uuid, person_uuid
        )
        SELECT
          snapshot->>'ProvinceNameThai_Onec', snapshot->>'DistrictNameThai_Onec',
          snapshot->>'SubDistrictNameThai_Onec', snapshot->>'PersonID_Onec',
          snapshot->>'Fullname_Onec', snapshot->>'Gender_Onec',
          snapshot->>'NationalityName_Onec', snapshot->>'BirthDate_Onec',
          snapshot->>'HouseNumber_Onec', snapshot->>'VillageNumber_Onec',
          snapshot->>'Street_Onec', snapshot->>'Soi_Onec', snapshot->>'Trok_Onec',
          snapshot->>'StatusCodeCause_Onec', snapshot->>'Remark_Onec',
          snapshot->>'SchoolName_Onec', (snapshot->>'GradeLevelID_Onec')::integer,
          (snapshot->>'AcademicYearPresent_Onec')::integer,
          (snapshot->>'DropoutTransferID_Onec')::integer, (snapshot->>'ACADYEAR')::integer,
          (snapshot->>'RoomID_Onec')::integer, (snapshot->>'SchoolID_Onec')::integer,
          (snapshot->>'GenderID_Onec')::integer, (snapshot->>'GPAX_Onec')::real,
          (snapshot->>'created_at')::timestamptz, (snapshot->>'updated_at')::timestamptz,
          (snapshot->>'created_by')::integer, (snapshot->>'updated_by')::integer,
          (snapshot->>'deleted_at')::timestamptz, (snapshot->>'deleted_by')::integer,
          (snapshot->>'student_uuid')::uuid, (snapshot->>'person_uuid')::uuid
        FROM (
          SELECT source_record_snapshot AS snapshot
          FROM student_exit_events
          WHERE source_system = $1
        ) source_rows
      `,
      [SOURCE_SYSTEM],
    );

    await queryRunner.query(`
      ALTER TABLE student_import_batches
        DROP CONSTRAINT chk_student_import_batches_target;
      UPDATE student_import_batches
      SET target = 'student_dropouts'
      WHERE target = 'student_exit_events';
      ALTER TABLE student_import_batches
        ADD CONSTRAINT chk_student_import_batches_target
          CHECK (target IN ('student_term', 'student_dropouts', 'school_teacher_membership'));
    `);
  }
}
