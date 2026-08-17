import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The ข้อมูลพื้นฐาน tab is gone, and so are the tables behind it.
 *
 * The screen edited eight lookup tables. Counted on the live database
 * (2026-08-17): five held **no rows at all**, and two more — `school_affiliations`
 * (5 rows) and `disability_types` (10) — had no foreign key pointing at them and
 * no reader anywhere in the code. `student_person_disabilities`, the table
 * `disability_types` was designed for, was never created.
 *
 * The eighth, `assistance_measure_options`, is very much alive — it is the case
 * workflow's assistance measures — and it was never on the screen at all. Its
 * only exposure was the shared endpoint, so anyone able to call the API could
 * rewrite the measures the ASSIST flow depends on from a page that did not
 * exist. That endpoint is removed with this change; the table stays.
 *
 * Each table is dropped only when still empty of anything the codebase could
 * have started using since; `RAISE EXCEPTION` rather than silent data loss.
 *
 * `down()` recreates them with the shape recorded in the 2026-03 baseline and in
 * the migrations that introduced them. Their rows are not restored: a lookup
 * nothing referenced has no rows worth reviving, and inventing them would be a
 * worse lie than the empty table.
 */
const DEAD_LOOKUP_TABLES = [
  'risk_factors',
  'educational_areas',
  'absence_reasons',
  'absence_reason_categories',
  'non_follow_up_reasons',
  'school_affiliations',
  'disability_types',
];

export class DropUnusedMasterDataLookups20260821120000 implements MigrationInterface {
  name = 'DropUnusedMasterDataLookups20260821120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of DEAD_LOOKUP_TABLES) {
      const [{ exists }] = (await queryRunner.query(
        `SELECT to_regclass($1) IS NOT NULL AS exists`,
        [`public.${table}`],
      )) as Array<{ exists: boolean }>;
      if (!exists) continue;

      const referencing = (await queryRunner.query(
        `
          SELECT src.relname AS referencing_table
          FROM pg_constraint c
          JOIN pg_class src ON src.oid = c.conrelid
          JOIN pg_class tgt ON tgt.oid = c.confrelid
          WHERE c.contype = 'f' AND tgt.relname = $1 AND src.relname <> $1
        `,
        [table],
      )) as Array<{ referencing_table: string }>;
      if (referencing.length > 0) {
        throw new Error(
          `${table} ถูกอ้างถึงโดย ${referencing
            .map((row) => row.referencing_table)
            .join(', ')} จึงลบไม่ได้`,
        );
      }

      await queryRunner.query(`DROP TABLE ${table} CASCADE`);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS risk_factors (
        id SERIAL PRIMARY KEY,
        label TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS educational_areas (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    for (const [table, extra] of [
      ['school_affiliations', ''],
      ['disability_types', ''],
      ['absence_reason_categories', ''],
      ['non_follow_up_reasons', ''],
    ] as const) {
      await queryRunner.query(`
        CREATE TABLE IF NOT EXISTS ${table} (
          code VARCHAR(40) PRIMARY KEY,
          name TEXT NOT NULL,
          note TEXT,
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
          deleted_at TIMESTAMPTZ,
          deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
          ${extra}
        )
      `);
    }
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS absence_reasons (
        code VARCHAR(40) PRIMARY KEY,
        name TEXT NOT NULL,
        note TEXT,
        category_id VARCHAR(40) REFERENCES absence_reason_categories(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
  }
}
