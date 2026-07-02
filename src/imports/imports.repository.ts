import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import {
  IMPORT_TARGET_COLUMNS,
  SERVER_INJECTED_COLUMNS,
  STUDENT_TERM_MUTABLE_IMPORT_COLUMNS,
  STUDENT_TERM_NATURAL_KEY_COLUMNS,
} from './imports.types';
import type {
  ExistingImportPersonIdRow,
  ExistingSchoolIdRow,
  ExistingStudentTermRow,
  ImportReferenceRow,
  ImportTarget,
  ImportWriteAction,
  ManualSchool,
  QueryExecutor,
  QueryResultLike,
} from './imports.types';

@Injectable()
export class ImportsRepository {
  constructor(private readonly dataSource: DataSource) {}

  private async query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResultLike<T>> {
    return await queryDataSource<T>(this.dataSource, sql, params);
  }

  private getExecutor(executor?: QueryExecutor): QueryExecutor {
    if (executor) {
      return executor;
    }

    return {
      query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
        return await this.query<T>(sql, params);
      },
    };
  }

  async withTransaction<T>(callback: (executor: QueryExecutor) => Promise<T>): Promise<T> {
    return await withDataSourceTransaction(this.dataSource, async (executor) => {
      return await callback(executor);
    });
  }

  async findExistingSchoolIds(schoolIds: number[]): Promise<number[]> {
    if (schoolIds.length === 0) {
      return [];
    }

    const result = await this.query<ExistingSchoolIdRow>(
      'SELECT id FROM schools WHERE id = ANY($1::int[])',
      [schoolIds],
    );

    return result.rows.map((row) => Number(row.id));
  }

  async findExistingImportPersonIds(target: ImportTarget, personIds: string[]): Promise<string[]> {
    if (personIds.length === 0) {
      return [];
    }

    const result = await this.query<ExistingImportPersonIdRow>(
      `
        SELECT "PersonID_Onec" AS person_id
        FROM ${target}
        WHERE "PersonID_Onec" = ANY($1::text[])
      `,
      [personIds],
    );

    return result.rows.map((row) => String(row.person_id));
  }

  async findExistingStudentTerms(personIds: string[]): Promise<ExistingStudentTermRow[]> {
    if (personIds.length === 0) {
      return [];
    }

    const result = await this.query<ExistingStudentTermRow>(
      `
        SELECT
          identifier.identifier_normalized AS person_id,
          enrollment."AcademicYear_Onec"::text AS academic_year,
          enrollment."Semester_Onec"::text AS semester,
          enrollment."SchoolID_Onec"::text AS school_id
        FROM student_term enrollment
        JOIN student_person_identifier identifier
          ON identifier.person_uuid = enrollment.person_uuid
         AND identifier.identifier_type = 'NATIONAL_ID'
        WHERE identifier.identifier_normalized = ANY($1::text[])
      `,
      [personIds],
    );

    return result.rows;
  }

  async findSchoolNames(schoolIds: number[]): Promise<ImportReferenceRow[]> {
    if (schoolIds.length === 0) {
      return [];
    }

    const result = await this.query<ImportReferenceRow>(
      'SELECT id, name AS label FROM schools WHERE id = ANY($1::int[])',
      [schoolIds],
    );
    return result.rows;
  }

  async findGradeLabels(gradeIds: number[]): Promise<ImportReferenceRow[]> {
    if (gradeIds.length === 0) {
      return [];
    }

    const result = await this.query<ImportReferenceRow>(
      'SELECT id, label FROM grade_levels WHERE id = ANY($1::int[])',
      [gradeIds],
    );
    return result.rows;
  }

  async upsertManualSchool(school: ManualSchool, executor?: QueryExecutor): Promise<void> {
    const queryExecutor = this.getExecutor(executor);

    await queryExecutor.query(
      `
        INSERT INTO schools (id, name, province, district, sub_district)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          province = EXCLUDED.province,
          district = EXCLUDED.district,
          sub_district = EXCLUDED.sub_district
      `,
      [
        school.id,
        school.name,
        school.province ?? null,
        school.district ?? null,
        school.sub_district ?? null,
      ],
    );
  }

  async resolveOrCreatePersonByNationalId(
    identifierValue: string,
    identifierNormalized: string,
    executor?: QueryExecutor,
  ): Promise<string> {
    const queryExecutor = this.getExecutor(executor);

    const existing = await queryExecutor.query<{ person_uuid: string }>(
      `
        SELECT person_uuid
        FROM student_person_identifier
        WHERE identifier_normalized = $1
          AND identifier_type = 'NATIONAL_ID'
        ORDER BY is_primary DESC, id ASC
        LIMIT 1
      `,
      [identifierNormalized],
    );
    const existingPersonUuid = existing.rows[0]?.person_uuid;
    if (existingPersonUuid) {
      return existingPersonUuid;
    }

    const created = await queryExecutor.query<{ person_uuid: string }>(
      `
        INSERT INTO student_person (identity_status)
        VALUES ('ACTIVE')
        RETURNING person_uuid
      `,
    );
    const personUuid = created.rows[0]?.person_uuid;
    if (!personUuid) {
      throw new Error('Failed to create student_person');
    }

    await queryExecutor.query(
      `
        INSERT INTO student_person_identifier (
          person_uuid,
          identifier_type,
          identifier_value,
          identifier_normalized,
          source
        )
        VALUES ($1, 'NATIONAL_ID', $2, $3, 'ONEC_IMPORT')
      `,
      [personUuid, identifierValue, identifierNormalized],
    );

    return personUuid;
  }

  async insertImportRow(
    target: ImportTarget,
    row: Record<string, unknown>,
    executor?: QueryExecutor,
  ): Promise<ImportWriteAction> {
    const queryExecutor = this.getExecutor(executor);
    const columns = Object.keys(row);

    // Defense in depth: column names are interpolated as SQL identifiers, so
    // reject anything outside the target's known columns even though the service
    // already validates the mapping. Fails closed against identifier injection.
    const allowedColumns = IMPORT_TARGET_COLUMNS[target];
    for (const column of columns) {
      if (!allowedColumns.has(column) && !SERVER_INJECTED_COLUMNS.has(column)) {
        throw new Error(`Illegal import column for ${target}: ${column}`);
      }
    }

    const values = Object.values(row);
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');

    if (target === 'student_term') {
      const mutableColumns = columns.filter((column) =>
        STUDENT_TERM_MUTABLE_IMPORT_COLUMNS.has(column),
      );
      const updateAssignments = mutableColumns.map(
        (column) => `"${column}" = COALESCE(EXCLUDED."${column}", student_term."${column}")`,
      );
      // Always execute the conflict branch so repeated imports are observable as
      // updates even when the file contains only natural-key columns.
      if (updateAssignments.length === 0) {
        updateAssignments.push('"PersonID_Onec" = student_term."PersonID_Onec"');
      }

      const result = await queryExecutor.query<{ inserted: boolean }>(
        `
          INSERT INTO student_term (${columns.map((column) => `"${column}"`).join(', ')})
          VALUES (${placeholders})
          ON CONFLICT (${STUDENT_TERM_NATURAL_KEY_COLUMNS.map((column) => `"${column}"`).join(', ')})
          DO UPDATE SET ${updateAssignments.join(', ')}
          RETURNING (xmax = 0) AS inserted
        `,
        values,
      );

      return result.rows[0]?.inserted ? 'inserted' : 'updated';
    }

    const result = await queryExecutor.query(
      `
        INSERT INTO ${target} (${columns.map((column) => `"${column}"`).join(', ')})
        VALUES (${placeholders})
        ON CONFLICT ("PersonID_Onec") DO NOTHING
      `,
      values,
    );

    return result.rowCount > 0 ? 'inserted' : 'skipped';
  }
}
