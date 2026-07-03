import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import { queryDataSource } from '../database/sql-query';
import type { StudentStatusSortField, StudentStatusRow } from './student-status.types';

interface ListOptions {
  page: number;
  limit: number;
  searchTerm?: string;
  sortBy: StudentStatusSortField;
  sortDirection: 'asc' | 'desc';
}

interface WriteValues {
  labelTh: string;
  category: string;
  badgeVariant: string;
  isActiveForLogin: boolean;
  isTerminal: boolean;
  requiresFollowup: boolean;
  isEnabled: boolean;
  sortOrder: number;
  sourceSystem: string;
  actorId: number | null;
}

interface CountRow extends Record<string, unknown> {
  total: number;
}

const SORT_COLUMNS: Record<StudentStatusSortField, string> = {
  code: 'status.code',
  labelTh: 'status.label_th',
  category: 'status.category',
  sortOrder: 'status.sort_order',
};

const SELECT_COLUMNS = `
  status.code,
  status.label_th,
  status.category,
  status.badge_variant,
  status.is_active_for_login,
  status.is_terminal,
  status.requires_followup,
  status.is_enabled,
  status.sort_order,
  status.source_system,
  COUNT(enrollment.student_uuid)::int AS usage_count
`;

@Injectable()
export class StudentStatusRepository {
  constructor(private readonly dataSource: DataSource) {}

  async list(options: ListOptions): Promise<{ rows: StudentStatusRow[]; totalCount: number }> {
    const params: unknown[] = [];
    let whereSql = '';
    if (options.searchTerm) {
      params.push(`%${options.searchTerm}%`);
      whereSql = `
        WHERE status.label_th ILIKE $1
           OR status.category ILIKE $1
           OR status.source_system ILIKE $1
           OR status.code::text ILIKE $1
      `;
    }

    const countResult = await queryDataSource<CountRow>(
      this.dataSource,
      `SELECT COUNT(*)::int AS total FROM student_status status ${whereSql}`,
      params,
    );
    const offset = (options.page - 1) * options.limit;
    const listParams = [...params, options.limit, offset];
    const limitPlaceholder = listParams.length - 1;
    const offsetPlaceholder = listParams.length;
    const sortColumn = SORT_COLUMNS[options.sortBy];
    const direction = options.sortDirection === 'desc' ? 'DESC' : 'ASC';
    const result = await queryDataSource<StudentStatusRow>(
      this.dataSource,
      `
        SELECT ${SELECT_COLUMNS}
        FROM student_status status
        LEFT JOIN student_term enrollment
          ON COALESCE(enrollment.student_status_code, enrollment."StudentStatusID_Onec") = status.code
        ${whereSql}
        GROUP BY status.code
        ORDER BY ${sortColumn} ${direction}, status.code ASC
        LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
      `,
      listParams,
    );

    return { rows: result.rows, totalCount: countResult.rows[0]?.total ?? 0 };
  }

  async findByCode(code: number, queryRunner?: QueryRunner): Promise<StudentStatusRow | null> {
    const executor = queryRunner ?? this.dataSource;
    const rows = (await executor.query(
      `
        SELECT ${SELECT_COLUMNS}
        FROM student_status status
        LEFT JOIN student_term enrollment
          ON COALESCE(enrollment.student_status_code, enrollment."StudentStatusID_Onec") = status.code
        WHERE status.code = $1
        GROUP BY status.code
      `,
      [code],
    )) as StudentStatusRow[];
    return rows[0] ?? null;
  }

  async withTransaction<T>(operation: (queryRunner: QueryRunner) => Promise<T>): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const result = await operation(queryRunner);
      await queryRunner.commitTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async create(code: number, values: WriteValues, queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        INSERT INTO student_status (
          code, label_th, category, badge_variant, is_active_for_login, is_terminal,
          requires_followup, is_enabled, sort_order, source_system,
          created_by, updated_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
      `,
      [
        code,
        values.labelTh,
        values.category,
        values.badgeVariant,
        values.isActiveForLogin,
        values.isTerminal,
        values.requiresFollowup,
        values.isEnabled,
        values.sortOrder,
        values.sourceSystem,
        values.actorId,
      ],
    );
  }

  async update(code: number, values: WriteValues, queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE student_status
        SET label_th = $2,
            category = $3,
            badge_variant = $4,
            is_active_for_login = $5,
            is_terminal = $6,
            requires_followup = $7,
            is_enabled = $8,
            sort_order = $9,
            source_system = $10,
            updated_by = $11
        WHERE code = $1
      `,
      [
        code,
        values.labelTh,
        values.category,
        values.badgeVariant,
        values.isActiveForLogin,
        values.isTerminal,
        values.requiresFollowup,
        values.isEnabled,
        values.sortOrder,
        values.sourceSystem,
        values.actorId,
      ],
    );
  }
}
