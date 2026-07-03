import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource, withDataSourceTransaction } from '../database/sql-query';
import { buildDataScopeQuery, type DataScope } from '../common/utils/authorization';
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
  ImportQuarantineReason,
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

  async findExistingSchoolIds(schoolIds: number[], executor?: QueryExecutor): Promise<number[]> {
    if (schoolIds.length === 0) {
      return [];
    }

    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<ExistingSchoolIdRow>(
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

  async findExistingStudentTerms(
    personIds: string[],
    scope: DataScope,
  ): Promise<ExistingStudentTermRow[]> {
    if (personIds.length === 0) {
      return [];
    }

    const scopeQuery = buildDataScopeQuery(
      scope,
      {
        school_id: 'enrollment."SchoolID_Onec"',
        province: 'school.province',
        district: 'school.district',
        sub_district: 'school.sub_district',
        grade: 'enrollment."GradeLevelID_Onec"',
        room: 'enrollment."RoomID_Onec"::text',
      },
      2,
    );

    const result = await this.query<ExistingStudentTermRow>(
      `
        SELECT
          identifier.identifier_normalized AS person_id,
          enrollment."AcademicYear_Onec"::text AS academic_year,
          enrollment."Semester_Onec"::text AS semester,
          enrollment."SchoolID_Onec"::text AS school_id,
          jsonb_build_object(
            'FirstName_Onec', enrollment."FirstName_Onec",
            'LastName_Onec', enrollment."LastName_Onec",
            'GradeLevelID_Onec', enrollment."GradeLevelID_Onec",
            'RoomID_Onec', enrollment."RoomID_Onec",
            'StudentStatusID_Onec', enrollment."StudentStatusID_Onec"
          ) AS mutable_values
        FROM student_term enrollment
        JOIN student_person_identifier identifier
          ON identifier.person_uuid = enrollment.person_uuid
         AND identifier.identifier_type = 'NATIONAL_ID'
        LEFT JOIN schools school ON school.id = enrollment."SchoolID_Onec"
        WHERE identifier.identifier_normalized = ANY($1::text[])
          ${scopeQuery.sql ? `AND ${scopeQuery.sql}` : ''}
      `,
      [personIds, ...scopeQuery.params],
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

  async findSchoolScopeDetails(schoolIds: number[]): Promise<
    Array<{
      id: number;
      province: string | null;
      district: string | null;
      sub_district: string | null;
    }>
  > {
    if (schoolIds.length === 0) return [];
    const result = await this.query<{
      id: number;
      province: string | null;
      district: string | null;
      sub_district: string | null;
    }>(`SELECT id, province, district, sub_district FROM schools WHERE id = ANY($1::int[])`, [
      schoolIds,
    ]);
    return result.rows;
  }

  async findGradeLabels(
    gradeIds: number[],
    executor?: QueryExecutor,
  ): Promise<ImportReferenceRow[]> {
    if (gradeIds.length === 0) {
      return [];
    }

    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<ImportReferenceRow>(
      'SELECT id, label FROM grade_levels WHERE id = ANY($1::int[])',
      [gradeIds],
    );
    return result.rows;
  }

  async findStudentStatusLabels(
    statusCodes: number[],
    executor?: QueryExecutor,
  ): Promise<ImportReferenceRow[]> {
    if (statusCodes.length === 0) {
      return [];
    }

    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<ImportReferenceRow>(
      `
        SELECT code AS id, label_th AS label, category
        FROM student_status
        WHERE code = ANY($1::int[])
      `,
      [statusCodes],
    );
    return result.rows;
  }

  async upsertManualSchool(school: ManualSchool, executor?: QueryExecutor): Promise<void> {
    const queryExecutor = this.getExecutor(executor);

    await queryExecutor.query(
      `
        INSERT INTO schools (id, name, province, district, sub_district)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO NOTHING
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

  async createImportBatch(
    input: {
      target: ImportTarget;
      sourceSha256: string;
      scopeSnapshot: unknown;
      totalRows: number;
      actorUserId: number | null;
    },
    executor?: QueryExecutor,
  ): Promise<string> {
    const queryExecutor = this.getExecutor(executor);
    const result = await queryExecutor.query<{ id: string }>(
      `INSERT INTO student_import_batches
        (target, source_sha256, scope_snapshot, total_rows, created_by, updated_by)
       VALUES ($1, $2, $3::jsonb, $4, $5, $5)
       RETURNING id`,
      [
        input.target,
        input.sourceSha256,
        JSON.stringify(input.scopeSnapshot),
        input.totalRows,
        input.actorUserId,
      ],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error('Failed to create student import batch');
    return id;
  }

  async findPersonUuidsByNationalId(
    identifierNormalized: string,
    scope: DataScope,
    executor: QueryExecutor,
    limit = 2,
  ): Promise<string[]> {
    const scopeQuery = buildDataScopeQuery(
      scope,
      {
        school_id: 'scoped_enrollment."SchoolID_Onec"',
        province: 'scoped_school.province',
        district: 'scoped_school.district',
        sub_district: 'scoped_school.sub_district',
        grade: 'scoped_enrollment."GradeLevelID_Onec"',
        room: 'scoped_enrollment."RoomID_Onec"::text',
      },
      3,
    );
    const result = await executor.query<{ person_uuid: string }>(
      `SELECT DISTINCT identifier.person_uuid
       FROM student_person_identifier identifier
       WHERE identifier.identifier_normalized = $1
         AND identifier.identifier_type = 'NATIONAL_ID'
         AND EXISTS (
           SELECT 1
           FROM student_term scoped_enrollment
           LEFT JOIN schools scoped_school ON scoped_school.id = scoped_enrollment."SchoolID_Onec"
           WHERE scoped_enrollment.person_uuid = identifier.person_uuid
             AND scoped_enrollment.deleted_at IS NULL
             ${scopeQuery.sql ? `AND ${scopeQuery.sql}` : ''}
         )
       ORDER BY identifier.person_uuid
       LIMIT $2`,
      [identifierNormalized, limit, ...scopeQuery.params],
    );
    return result.rows.map((row) => row.person_uuid);
  }

  async findPersonUuidMatchesByNationalIds(
    identifiersNormalized: string[],
    executor: QueryExecutor,
  ): Promise<Array<{ identifier_normalized: string; person_uuid: string }>> {
    if (identifiersNormalized.length === 0) return [];
    const result = await executor.query<{
      identifier_normalized: string;
      person_uuid: string;
    }>(
      `SELECT DISTINCT identifier_normalized, person_uuid
       FROM student_person_identifier
       WHERE identifier_type = 'NATIONAL_ID'
         AND identifier_normalized = ANY($1::text[])
       ORDER BY identifier_normalized, person_uuid`,
      [identifiersNormalized],
    );
    return result.rows;
  }

  async findPersonCandidateDetailsByNationalId(
    identifierNormalized: string,
    scope: DataScope,
    executor: QueryExecutor,
  ): Promise<Array<{ person_uuid: string; first_name: string | null; last_name: string | null }>> {
    const scopeQuery = buildDataScopeQuery(
      scope,
      {
        school_id: 'scoped_enrollment."SchoolID_Onec"',
        province: 'scoped_school.province',
        district: 'scoped_school.district',
        sub_district: 'scoped_school.sub_district',
        grade: 'scoped_enrollment."GradeLevelID_Onec"',
        room: 'scoped_enrollment."RoomID_Onec"::text',
      },
      2,
    );
    const result = await executor.query<{
      person_uuid: string;
      first_name: string | null;
      last_name: string | null;
    }>(
      `SELECT candidates.person_uuid,
              scoped_enrollment."FirstName_Onec" AS first_name,
              scoped_enrollment."LastName_Onec" AS last_name
       FROM (
         SELECT DISTINCT person_uuid
         FROM student_person_identifier
         WHERE identifier_normalized = $1 AND identifier_type = 'NATIONAL_ID'
       ) candidates
       JOIN LATERAL (
         SELECT scoped_enrollment."FirstName_Onec", scoped_enrollment."LastName_Onec",
                scoped_enrollment."AcademicYear_Onec", scoped_enrollment."Semester_Onec",
                scoped_enrollment.student_uuid
         FROM student_term scoped_enrollment
         LEFT JOIN schools scoped_school ON scoped_school.id = scoped_enrollment."SchoolID_Onec"
         WHERE scoped_enrollment.person_uuid = candidates.person_uuid
           AND scoped_enrollment.deleted_at IS NULL
           ${scopeQuery.sql ? `AND ${scopeQuery.sql}` : ''}
         ORDER BY scoped_enrollment."AcademicYear_Onec" DESC,
                  scoped_enrollment."Semester_Onec" DESC,
                  scoped_enrollment.student_uuid DESC
         LIMIT 1
       ) scoped_enrollment ON TRUE
       ORDER BY candidates.person_uuid
       LIMIT 50`,
      [identifierNormalized, ...scopeQuery.params],
    );
    return result.rows;
  }

  async findConflictingNationalIds(identifierNormalized: string[]): Promise<string[]> {
    if (identifierNormalized.length === 0) return [];
    const result = await this.query<{ identifier_normalized: string }>(
      `SELECT identifier_normalized
       FROM student_person_identifier
       WHERE identifier_type = 'NATIONAL_ID'
         AND identifier_normalized = ANY($1::text[])
       GROUP BY identifier_normalized
       HAVING COUNT(DISTINCT person_uuid) > 1`,
      [identifierNormalized],
    );
    return result.rows.map((row) => row.identifier_normalized);
  }

  async quarantineImportRow(
    input: {
      batchId: string;
      schoolId: number | null;
      sourceRowNumber: number;
      rowFingerprint: string;
      reasonCode: ImportQuarantineReason;
      mappedValues: Record<string, unknown>;
      actorUserId: number | null;
    },
    executor: QueryExecutor,
  ): Promise<boolean> {
    const result = await executor.query(
      `INSERT INTO student_import_quarantine_rows
        (batch_id, school_id, source_row_number, row_fingerprint, reason_code,
         mapped_values, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)
       ON CONFLICT (row_fingerprint, reason_code)
         WHERE status = 'PENDING' AND deleted_at IS NULL
       DO NOTHING`,
      [
        input.batchId,
        input.schoolId,
        input.sourceRowNumber,
        input.rowFingerprint,
        input.reasonCode,
        JSON.stringify(input.mappedValues),
        input.actorUserId,
      ],
    );
    return result.rowCount > 0;
  }

  async completeImportBatch(
    batchId: string,
    counts: { importedRows: number; quarantinedRows: number },
    executor: QueryExecutor,
  ): Promise<void> {
    await executor.query(
      `UPDATE student_import_batches
       SET status = CASE WHEN $3 > 0 THEN 'PARTIAL' ELSE 'COMPLETED' END,
           imported_rows = $2, quarantined_rows = $3, completed_at = now()
       WHERE id = $1`,
      [batchId, counts.importedRows, counts.quarantinedRows],
    );
  }

  async failImportBatch(batchId: string): Promise<void> {
    await this.query(
      `UPDATE student_import_batches
       SET status = 'FAILED', completed_at = now()
       WHERE id = $1 AND status = 'RUNNING'`,
      [batchId],
    );
  }

  private quarantineScope(scope: DataScope, startIndex: number) {
    return buildDataScopeQuery(
      scope,
      {
        school_id: 'q.school_id',
        province: 's.province',
        district: 's.district',
        sub_district: 's.sub_district',
        grade: `CASE WHEN q.mapped_values->>'GradeLevelID_Onec' ~ '^\\d+$'
          THEN (q.mapped_values->>'GradeLevelID_Onec')::int END`,
        room: `q.mapped_values->>'RoomID_Onec'`,
      },
      startIndex,
    );
  }

  async listQuarantine(
    filters: {
      page: number;
      limit: number;
      status?: string;
      reasonCode?: string;
      search?: string;
      province?: string;
      district?: string;
      subDistrict?: string;
      schoolId?: number;
    },
    scope: DataScope,
  ): Promise<{ rows: Record<string, unknown>[]; totalCount: number }> {
    const params: unknown[] = [];
    const clauses = [`q.deleted_at IS NULL`];
    if (filters.status) {
      params.push(filters.status);
      clauses.push(`q.status = $${params.length}`);
    }
    if (filters.reasonCode) {
      params.push(filters.reasonCode);
      clauses.push(`q.reason_code = $${params.length}`);
    }
    if (filters.schoolId) {
      params.push(filters.schoolId);
      clauses.push(`q.school_id = $${params.length}`);
    }
    if (filters.province) {
      params.push(filters.province);
      clauses.push(`s.province = $${params.length}`);
    }
    if (filters.district) {
      params.push(filters.district);
      clauses.push(`s.district = $${params.length}`);
    }
    if (filters.subDistrict) {
      params.push(filters.subDistrict);
      clauses.push(`s.sub_district = $${params.length}`);
    }
    const searchTerm = filters.search?.trim();
    if (searchTerm) {
      params.push(`%${searchTerm.replace(/[\\%_]/g, '\\$&')}%`);
      clauses.push(
        `(q.mapped_values->>'FirstName_Onec' ILIKE $${params.length}
          OR q.mapped_values->>'LastName_Onec' ILIKE $${params.length}
          OR s.name ILIKE $${params.length})`,
      );
    }
    const scopeQuery = this.quarantineScope(scope, params.length + 1);
    if (scopeQuery.sql) clauses.push(scopeQuery.sql);
    params.push(...scopeQuery.params);
    const where = clauses.join(' AND ');
    const count = await this.query<{ total_count: string }>(
      `SELECT COUNT(*)::text AS total_count
       FROM student_import_quarantine_rows q
       LEFT JOIN schools s ON s.id = q.school_id
       WHERE ${where}`,
      params,
    );
    const listParams = [...params, filters.limit, (filters.page - 1) * filters.limit];
    const rows = await this.query<Record<string, unknown>>(
      `SELECT q.id::text, q.school_id, s.name AS school_name, q.source_row_number,
              q.reason_code, q.status, q.mapped_values, q.created_at, q.resolved_at,
              q.batch_id::text, b.target, b.created_at AS batch_created_at
       FROM student_import_quarantine_rows q
       JOIN student_import_batches b ON b.id = q.batch_id
       LEFT JOIN schools s ON s.id = q.school_id
       WHERE ${where}
       ORDER BY q.created_at DESC, q.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      listParams,
    );
    return { rows: rows.rows, totalCount: Number(count.rows[0]?.total_count ?? 0) };
  }

  private async findQuarantineRow(
    id: string,
    scope: DataScope,
    executor: QueryExecutor,
    forUpdate: boolean,
  ): Promise<Record<string, unknown> | null> {
    const scopeQuery = this.quarantineScope(scope, 2);
    const result = await executor.query<Record<string, unknown>>(
      `SELECT q.*, b.target
       FROM student_import_quarantine_rows q
       JOIN student_import_batches b ON b.id = q.batch_id
       LEFT JOIN schools s ON s.id = q.school_id
       WHERE q.id = $1 AND q.deleted_at IS NULL
         ${scopeQuery.sql ? `AND ${scopeQuery.sql}` : ''}
       ${forUpdate ? 'FOR UPDATE OF q' : ''}`,
      [id, ...scopeQuery.params],
    );
    return result.rows[0] ?? null;
  }

  async findQuarantine(
    id: string,
    scope: DataScope,
    executor: QueryExecutor,
  ): Promise<Record<string, unknown> | null> {
    return await this.findQuarantineRow(id, scope, executor, false);
  }

  async findQuarantineForUpdate(
    id: string,
    scope: DataScope,
    executor: QueryExecutor,
  ): Promise<Record<string, unknown> | null> {
    return await this.findQuarantineRow(id, scope, executor, true);
  }

  async resolveQuarantineRow(
    id: string,
    input: { status: 'RESOLVED' | 'REJECTED'; personUuid?: string; note?: string; actorId: number },
    executor: QueryExecutor,
  ): Promise<void> {
    await executor.query(
      `UPDATE student_import_quarantine_rows
       SET status = $2, resolved_person_uuid = $3, resolution_note = $4,
           resolved_at = now(), resolved_by = $5, updated_by = $5
       WHERE id = $1`,
      [id, input.status, input.personUuid ?? null, input.note ?? null, input.actorId],
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

  async createPersonForNationalId(
    identifierValue: string,
    identifierNormalized: string,
    executor?: QueryExecutor,
  ): Promise<string> {
    const queryExecutor = this.getExecutor(executor);
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
