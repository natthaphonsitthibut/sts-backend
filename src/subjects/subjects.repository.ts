import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import { queryDataSource } from '../database/sql-query';
import type { SubjectRow } from './subjects.types';

interface ListOptions {
  page: number;
  limit: number;
  searchTerm?: string;
  isActive?: boolean;
}

interface CountRow extends Record<string, unknown> {
  total: number;
}

const SELECT_COLUMNS = `id, code, name_th, is_active, created_at, updated_at`;

@Injectable()
export class SubjectsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async list(options: ListOptions): Promise<{ rows: SubjectRow[]; totalCount: number }> {
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (options.searchTerm) {
      params.push(`%${options.searchTerm}%`);
      conditions.push(`(code ILIKE $${params.length} OR name_th ILIKE $${params.length})`);
    }
    if (options.isActive !== undefined) {
      params.push(options.isActive);
      conditions.push(`is_active = $${params.length}`);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await queryDataSource<CountRow>(
      this.dataSource,
      `SELECT COUNT(*)::int AS total FROM subjects ${whereSql}`,
      params,
    );
    const offset = (options.page - 1) * options.limit;
    const listParams = [...params, options.limit, offset];
    const limitPlaceholder = listParams.length - 1;
    const offsetPlaceholder = listParams.length;
    const result = await queryDataSource<SubjectRow>(
      this.dataSource,
      `
        SELECT ${SELECT_COLUMNS}
        FROM subjects
        ${whereSql}
        ORDER BY code ASC
        LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}
      `,
      listParams,
    );

    return { rows: result.rows, totalCount: countResult.rows[0]?.total ?? 0 };
  }

  async findById(id: number): Promise<SubjectRow | null> {
    const result = await queryDataSource<SubjectRow>(
      this.dataSource,
      `SELECT ${SELECT_COLUMNS} FROM subjects WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findByCode(code: string): Promise<SubjectRow | null> {
    const result = await queryDataSource<SubjectRow>(
      this.dataSource,
      `SELECT ${SELECT_COLUMNS} FROM subjects WHERE code = $1`,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async create(
    code: string,
    nameTh: string,
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<SubjectRow> {
    const rows = (await queryRunner.query(
      `
        INSERT INTO subjects (code, name_th, created_by, updated_by)
        VALUES ($1, $2, $3, $3)
        RETURNING ${SELECT_COLUMNS}
      `,
      [code, nameTh, actorId],
    )) as SubjectRow[];
    return rows[0];
  }

  async update(
    id: number,
    values: { nameTh?: string; isActive?: boolean },
    actorId: number | null,
    queryRunner: QueryRunner,
  ): Promise<SubjectRow | null> {
    const rows = (await queryRunner.query(
      `
        UPDATE subjects
        SET name_th = COALESCE($2, name_th),
            is_active = COALESCE($3, is_active),
            updated_by = $4
        WHERE id = $1
        RETURNING ${SELECT_COLUMNS}
      `,
      [id, values.nameTh ?? null, values.isActive ?? null, actorId],
    )) as SubjectRow[];
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
}
