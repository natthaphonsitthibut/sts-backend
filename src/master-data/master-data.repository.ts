import { Injectable } from '@nestjs/common';
import { DataSource, type QueryRunner } from 'typeorm';
import type {
  CodedMasterDataCatalog,
  CodedMasterDataRow,
  ReferralAgencyRow,
} from './master-data.types';

interface CatalogDefinition {
  table: string;
  categoryColumn?: string;
  categoryCatalog?: CodedMasterDataCatalog;
  sourceColumn?: string;
  requiresDetailColumn?: string;
  usageSql: string;
}

const CATALOGS: Record<CodedMasterDataCatalog, CatalogDefinition> = {
  'absence-reason-categories': {
    table: 'absence_reason_categories',
    usageSql:
      '(SELECT COUNT(*)::int FROM absence_reasons usage WHERE usage.category_code = item.code)',
  },
  'absence-reasons': {
    table: 'absence_reasons',
    categoryColumn: 'category_code',
    categoryCatalog: 'absence-reason-categories',
    usageSql:
      '(SELECT COUNT(*)::int FROM attendance_exceptions usage WHERE usage.absence_reason_code = item.code)',
  },
  'disadvantage-types': {
    table: 'disadvantage_types',
    sourceColumn: 'source_onec_code',
    usageSql:
      '(SELECT COUNT(*)::int FROM student_term_disadvantages usage WHERE usage.disadvantage_type_code = item.code)',
  },
  'disability-types': {
    table: 'disability_types',
    sourceColumn: 'source_onec_code',
    usageSql:
      '(SELECT COUNT(*)::int FROM student_disabilities usage WHERE usage.disability_type_code = item.code)',
  },
  'assistance-measures': {
    table: 'assistance_measure_options',
    requiresDetailColumn: 'requires_detail',
    usageSql:
      '(SELECT COUNT(*)::int FROM task_assistance_measures usage WHERE usage.assistance_measure_code = item.code)',
  },
  'referral-agency-kinds': {
    table: 'referral_agency_kinds',
    usageSql:
      '(SELECT COUNT(*)::int FROM referral_agencies usage WHERE usage.agency_kind_code = item.code)',
  },
  'non-follow-up-reasons': {
    table: 'non_follow_up_reason_options',
    usageSql:
      '(SELECT COUNT(*)::int FROM task_submissions usage WHERE usage.non_follow_up_reason_code = item.code)',
  },
};

interface ListOptions {
  searchTerm?: string;
  includeInactive: boolean;
  limit: number;
  offset: number;
}

interface CodedWriteValues {
  code: string;
  labelTh: string;
  sortOrder: number;
  isActive: boolean;
  categoryCode?: string | null;
  sourceOnecCode?: number | null;
  requiresDetail?: boolean;
  actorId: number | null;
}

interface ReferralAgencyWriteValues {
  agencyName: string;
  agencyKindCode: string;
  contactPhone: string | null;
  contactEmail: string | null;
  websiteUrl: string | null;
  isActive: boolean;
  actorId: number | null;
}

@Injectable()
export class MasterDataRepository {
  constructor(private readonly dataSource: DataSource) {}

  getDefinition(catalog: CodedMasterDataCatalog): CatalogDefinition {
    return CATALOGS[catalog];
  }

  async withTransaction<T>(operation: (runner: QueryRunner) => Promise<T>): Promise<T> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const result = await operation(runner);
      await runner.commitTransaction();
      return result;
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    } finally {
      await runner.release();
    }
  }

  async listCoded(
    catalog: CodedMasterDataCatalog,
    options: ListOptions,
    runner?: QueryRunner,
  ): Promise<{ rows: CodedMasterDataRow[]; totalCount: number }> {
    const definition = CATALOGS[catalog];
    const executor = runner ?? this.dataSource;
    const conditions = options.includeInactive ? [] : ['item.is_active = TRUE'];
    const params: unknown[] = [];
    if (options.searchTerm) {
      params.push(`%${options.searchTerm}%`);
      conditions.push(`(item.code ILIKE $1 OR item.label_th ILIKE $1)`);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRows = (await executor.query(
      `SELECT COUNT(*)::int AS total FROM ${definition.table} item ${whereSql}`,
      params,
    )) as Array<{ total: number }>;
    const listParams = [...params, options.limit, options.offset];
    const limitIndex = listParams.length - 1;
    const offsetIndex = listParams.length;
    const rows = (await executor.query(
      `
        SELECT item.code, item.label_th, item.sort_order, item.is_active,
          ${definition.categoryColumn ? `item.${definition.categoryColumn}` : 'NULL::varchar'} AS category_code,
          ${definition.sourceColumn ? `item.${definition.sourceColumn}` : 'NULL::smallint'} AS source_onec_code,
          ${definition.requiresDetailColumn ? `item.${definition.requiresDetailColumn}` : 'NULL::boolean'} AS requires_detail,
          ${definition.usageSql} AS usage_count
        FROM ${definition.table} item
        ${whereSql}
        ORDER BY item.sort_order, item.label_th, item.code
        LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      listParams,
    )) as CodedMasterDataRow[];
    return { rows, totalCount: countRows[0]?.total ?? 0 };
  }

  async findCoded(
    catalog: CodedMasterDataCatalog,
    code: string,
    runner?: QueryRunner,
  ): Promise<CodedMasterDataRow | null> {
    const result = await this.listCoded(
      catalog,
      { searchTerm: undefined, includeInactive: true, limit: 32767, offset: 0 },
      runner,
    );
    return result.rows.find((row) => row.code === code) ?? null;
  }

  async createCoded(
    catalog: CodedMasterDataCatalog,
    values: CodedWriteValues,
    runner: QueryRunner,
  ): Promise<void> {
    const definition = CATALOGS[catalog];
    const columns = ['code', 'label_th', 'sort_order', 'is_active', 'created_by', 'updated_by'];
    const params: unknown[] = [
      values.code,
      values.labelTh,
      values.sortOrder,
      values.isActive,
      values.actorId,
      values.actorId,
    ];
    if (definition.categoryColumn) {
      columns.push(definition.categoryColumn);
      params.push(values.categoryCode ?? null);
    }
    if (definition.sourceColumn) {
      columns.push(definition.sourceColumn);
      params.push(values.sourceOnecCode ?? null);
    }
    if (definition.requiresDetailColumn) {
      columns.push(definition.requiresDetailColumn);
      params.push(values.requiresDetail ?? false);
    }
    await runner.query(
      `INSERT INTO ${definition.table} (${columns.join(', ')})
       VALUES (${params.map((_, index) => `$${index + 1}`).join(', ')})`,
      params,
    );
  }

  async updateCoded(
    catalog: CodedMasterDataCatalog,
    code: string,
    values: CodedWriteValues,
    runner: QueryRunner,
  ): Promise<void> {
    const definition = CATALOGS[catalog];
    const assignments = ['label_th = $2', 'sort_order = $3', 'is_active = $4', 'updated_by = $5'];
    const params: unknown[] = [
      code,
      values.labelTh,
      values.sortOrder,
      values.isActive,
      values.actorId,
    ];
    if (definition.categoryColumn) {
      params.push(values.categoryCode ?? null);
      assignments.push(`${definition.categoryColumn} = $${params.length}`);
    }
    if (definition.sourceColumn) {
      params.push(values.sourceOnecCode ?? null);
      assignments.push(`${definition.sourceColumn} = $${params.length}`);
    }
    if (definition.requiresDetailColumn) {
      params.push(values.requiresDetail ?? false);
      assignments.push(`${definition.requiresDetailColumn} = $${params.length}`);
    }
    await runner.query(
      `UPDATE ${definition.table} SET ${assignments.join(', ')} WHERE code = $1`,
      params,
    );
  }

  async listReferralAgencies(options: ListOptions): Promise<{
    rows: ReferralAgencyRow[];
    totalCount: number;
  }> {
    const conditions = options.includeInactive ? [] : ['agency.is_active = TRUE'];
    const params: unknown[] = [];
    if (options.searchTerm) {
      params.push(`%${options.searchTerm}%`);
      conditions.push(`(
        agency.agency_name ILIKE $1 OR kind.label_th ILIKE $1
        OR agency.contact_phone ILIKE $1 OR agency.contact_email ILIKE $1
      )`);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const countRows = await this.dataSource.query<Array<{ total: number }>>(
      `SELECT COUNT(*)::int AS total
       FROM referral_agencies agency
       JOIN referral_agency_kinds kind ON kind.code = agency.agency_kind_code
       ${whereSql}`,
      params,
    );
    const listParams = [...params, options.limit, options.offset];
    const rows = await this.dataSource.query<ReferralAgencyRow[]>(
      `
        SELECT agency.id, agency.agency_name, agency.agency_kind_code,
          kind.label_th AS agency_kind_label_th, agency.contact_phone,
          agency.contact_email, agency.website_url, agency.is_active,
          (SELECT COUNT(*)::int FROM case_referrals usage
           WHERE usage.referral_agency_id = agency.id) AS usage_count
        FROM referral_agencies agency
        JOIN referral_agency_kinds kind ON kind.code = agency.agency_kind_code
        ${whereSql}
        ORDER BY agency.agency_name, agency.id
        LIMIT $${listParams.length - 1} OFFSET $${listParams.length}
      `,
      listParams,
    );
    return { rows, totalCount: countRows[0]?.total ?? 0 };
  }

  async findReferralAgency(id: number, runner?: QueryRunner): Promise<ReferralAgencyRow | null> {
    const executor = runner ?? this.dataSource;
    const rows = (await executor.query(
      `
        SELECT agency.id, agency.agency_name, agency.agency_kind_code,
          kind.label_th AS agency_kind_label_th, agency.contact_phone,
          agency.contact_email, agency.website_url, agency.is_active,
          (SELECT COUNT(*)::int FROM case_referrals usage
           WHERE usage.referral_agency_id = agency.id) AS usage_count
        FROM referral_agencies agency
        JOIN referral_agency_kinds kind ON kind.code = agency.agency_kind_code
        WHERE agency.id = $1
      `,
      [id],
    )) as ReferralAgencyRow[];
    return rows[0] ?? null;
  }

  async createReferralAgency(
    values: ReferralAgencyWriteValues,
    runner: QueryRunner,
  ): Promise<number> {
    const rows = (await runner.query(
      `
        INSERT INTO referral_agencies (
          agency_name, agency_kind_code, contact_phone, contact_email,
          website_url, is_active, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        RETURNING id
      `,
      [
        values.agencyName,
        values.agencyKindCode,
        values.contactPhone,
        values.contactEmail,
        values.websiteUrl,
        values.isActive,
        values.actorId,
      ],
    )) as Array<{ id: number }>;
    return rows[0].id;
  }

  async updateReferralAgency(
    id: number,
    values: ReferralAgencyWriteValues,
    runner: QueryRunner,
  ): Promise<void> {
    await runner.query(
      `
        UPDATE referral_agencies SET agency_name = $2, agency_kind_code = $3,
          contact_phone = $4, contact_email = $5, website_url = $6,
          is_active = $7, updated_by = $8
        WHERE id = $1
      `,
      [
        id,
        values.agencyName,
        values.agencyKindCode,
        values.contactPhone,
        values.contactEmail,
        values.websiteUrl,
        values.isActive,
        values.actorId,
      ],
    );
  }
}
