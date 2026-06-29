import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { AuthenticatedRequestUser, DataScope } from '../auth';
import { hasPermission } from '../auth/permissions.constants';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { queryDataSource } from '../database/sql-query';
import type { AuditLogDomain } from './dto/audit-log.dto';

/**
 * Closed vocabulary of audited sensitive actions. Centralised so both the
 * users/auth wiring and the task/imports/master-data wiring stay in sync and
 * a typo can't silently create an un-greppable action.
 */
export type AuditAction =
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_DELETE'
  | 'STUDENT_ACCOUNT_BULK_GENERATE'
  | 'STUDENT_TEMP_PASSWORD_REISSUE'
  | 'ROLE_GROUP_CREATE'
  | 'ROLE_GROUP_UPDATE'
  | 'ROLE_GROUP_DELETE'
  | 'CASE_CLOSE'
  | 'CASE_FORWARD'
  | 'CASE_REFERRAL_OUTCOME_UPDATE'
  | 'CASE_REVIEW'
  | 'CASE_AUTO_CANCEL'
  | 'ATTENDANCE_SUBMIT'
  | 'ATTENDANCE_REOPEN'
  | 'TASK_CREATE'
  | 'TASK_DELETE'
  | 'LINK_LOCK'
  | 'LINK_UNLOCK'
  | 'DELEGATION'
  | 'DATA_IMPORT'
  | 'MASTER_DATA_EDIT';

export interface AuditLogRecordInput {
  actorUserId?: number | null;
  actorLabel?: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
}

interface AuditActionDefinition {
  domain: AuditLogDomain;
  label: string;
  detailKeys: Array<{ key: string; label: string }>;
}

interface AuditLogRow extends Record<string, unknown> {
  id: string;
  actor_label: string | null;
  action: AuditAction;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  total_count: number | string;
}

interface SchoolScopeRow extends Record<string, unknown> {
  id: number;
  province: string | null;
  district: string | null;
  sub_district: string | null;
}

interface AuditLogListFilters {
  domain: AuditLogDomain;
  action?: string;
  searchTerm?: string;
  dateFrom?: string;
  dateTo?: string;
  province?: string;
  district?: string;
  subDistrict?: string;
  schoolId?: number;
  page?: number;
  limit?: number;
}

export interface AuditLogEntryResponse {
  id: string;
  domain: AuditLogDomain;
  action: AuditAction;
  actionLabel: string;
  actorLabel: string;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
  details: Array<{ label: string; value: string | number }>;
}

const ACTION_DEFINITIONS: Record<string, AuditActionDefinition> = {
  STUDENT_TEMP_PASSWORD_REISSUE: {
    domain: 'student_accounts',
    label: 'ออกรหัสชั่วคราวใหม่',
    detailKeys: [{ key: 'expiresAt', label: 'รหัสหมดอายุ' }],
  },
  STUDENT_ACCOUNT_BULK_GENERATE: {
    domain: 'student_accounts',
    label: 'สร้างบัญชีนักเรียนแบบชุด',
    detailKeys: [
      { key: 'createdCount', label: 'สร้างสำเร็จ' },
      { key: 'scopeLabel', label: 'ขอบเขต' },
      { key: 'province', label: 'จังหวัด' },
      { key: 'district', label: 'อำเภอ' },
      { key: 'subDistrict', label: 'ตำบล' },
      { key: 'schoolId', label: 'รหัสโรงเรียน' },
      { key: 'grade', label: 'ชั้นเรียน' },
      { key: 'room', label: 'ห้อง' },
    ],
  },
  DATA_IMPORT: {
    domain: 'imports',
    label: 'นำเข้าข้อมูล',
    detailKeys: [
      { key: 'target', label: 'ประเภทข้อมูล' },
      { key: 'rowCount', label: 'จำนวนทั้งหมด' },
      { key: 'rowsInserted', label: 'เพิ่มใหม่' },
      { key: 'rowsSkipped', label: 'ข้าม' },
    ],
  },
  USER_CREATE: {
    domain: 'users',
    label: 'สร้างผู้ใช้งาน',
    detailKeys: [{ key: 'username', label: 'ชื่อผู้ใช้' }],
  },
  USER_UPDATE: {
    domain: 'users',
    label: 'แก้ไขผู้ใช้งาน',
    detailKeys: [{ key: 'fieldCount', label: 'จำนวนข้อมูลที่แก้' }],
  },
  USER_DELETE: {
    domain: 'users',
    label: 'ปิดหรือลบผู้ใช้งาน',
    detailKeys: [{ key: 'username', label: 'ชื่อผู้ใช้' }],
  },
  TASK_CREATE: {
    domain: 'tasks',
    label: 'สร้างภารกิจหรือลิงก์',
    detailKeys: [
      { key: 'taskType', label: 'ประเภท' },
      { key: 'schoolId', label: 'รหัสโรงเรียน' },
      { key: 'grade', label: 'ชั้นเรียน' },
      { key: 'room', label: 'ห้อง' },
    ],
  },
  LINK_LOCK: {
    domain: 'login_links',
    label: 'ปิดลิงก์',
    detailKeys: [{ key: 'taskType', label: 'ประเภทลิงก์' }],
  },
  LINK_UNLOCK: {
    domain: 'login_links',
    label: 'เปิดลิงก์อีกครั้ง',
    detailKeys: [{ key: 'taskType', label: 'ประเภทลิงก์' }],
  },
  CASE_REVIEW: {
    domain: 'cases',
    label: 'ตรวจสอบเคส',
    detailKeys: [{ key: 'reviewAction', label: 'ผลการตรวจสอบ' }],
  },
  CASE_CLOSE: {
    domain: 'cases',
    label: 'ปิดเคส',
    detailKeys: [{ key: 'resolutionOutcome', label: 'ผลลัพธ์' }],
  },
  CASE_FORWARD: {
    domain: 'cases',
    label: 'ส่งต่อเคส',
    detailKeys: [],
  },
  CASE_REFERRAL_OUTCOME_UPDATE: {
    domain: 'cases',
    label: 'บันทึกผลการส่งต่อ',
    detailKeys: [{ key: 'status', label: 'สถานะ' }],
  },
  CASE_AUTO_CANCEL: {
    domain: 'cases',
    label: 'ยกเลิกเคสอัตโนมัติ',
    detailKeys: [],
  },
  TASK_DELETE: {
    domain: 'tasks',
    label: 'ลบภารกิจ',
    detailKeys: [],
  },
  DELEGATION: {
    domain: 'tasks',
    label: 'ส่งต่อภารกิจ',
    detailKeys: [{ key: 'toDepth', label: 'ลำดับการส่งต่อ' }],
  },
  ATTENDANCE_SUBMIT: {
    domain: 'attendance',
    label: 'บันทึกการเช็คชื่อ',
    detailKeys: [
      { key: 'attendanceDate', label: 'วันที่' },
      { key: 'recordedCount', label: 'บันทึกแล้ว' },
      { key: 'expectedRosterCount', label: 'นักเรียนทั้งหมด' },
      { key: 'revision', label: 'ครั้งที่แก้ไข' },
    ],
  },
  ATTENDANCE_REOPEN: {
    domain: 'attendance',
    label: 'เปิดรอบเช็คชื่อเพื่อแก้ไข',
    detailKeys: [
      { key: 'attendanceDate', label: 'วันที่' },
      { key: 'revision', label: 'ครั้งที่แก้ไข' },
    ],
  },
};

const DOMAIN_PERMISSIONS: Record<AuditLogDomain, string[]> = {
  student_accounts: ['manage-student-accounts'],
  imports: ['import-data'],
  users: ['manage-users-list'],
  login_links: ['login-links'],
  students: ['students'],
  cases: ['review-cases'],
  tasks: ['create', 'review-cases', 'attendance-dashboard'],
  attendance: ['attendance', 'attendance-dashboard'],
};

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly dataSource: DataSource) {}

  private normalizeScopeValues(value: unknown): Array<string | number> {
    if (!Array.isArray(value)) {
      return [];
    }

    return Array.from(
      new Set(
        value.filter(
          (entry): entry is string | number =>
            (typeof entry === 'string' && entry.trim().length > 0) ||
            (typeof entry === 'number' && Number.isFinite(entry)),
        ),
      ),
    );
  }

  private async addScopeSnapshot(
    metadata: Record<string, unknown> | null | undefined,
  ): Promise<Record<string, unknown> | null> {
    if (!metadata) {
      return null;
    }

    const sourceScope =
      metadata.scope && typeof metadata.scope === 'object' && !Array.isArray(metadata.scope)
        ? (metadata.scope as DataScope)
        : {};
    const schoolIds = this.normalizeScopeValues([
      ...this.normalizeScopeValues(sourceScope.school_ids),
      ...this.normalizeScopeValues(metadata.schoolIds),
      ...(metadata.schoolId !== null && metadata.schoolId !== undefined
        ? [metadata.schoolId as string | number]
        : []),
    ])
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0);

    const schools =
      schoolIds.length > 0
        ? (
            await queryDataSource<SchoolScopeRow>(
              this.dataSource,
              `SELECT id, province, district, sub_district FROM schools WHERE id = ANY($1::int[])`,
              [schoolIds],
            )
          ).rows
        : [];
    const uniqueStrings = (values: unknown[]): string[] =>
      Array.from(
        new Set(
          values
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      );
    const scope: DataScope = {
      provinces: uniqueStrings([
        ...this.normalizeScopeValues(sourceScope.provinces),
        metadata.province,
        ...schools.map((school) => school.province),
      ]),
      districts: uniqueStrings([
        ...this.normalizeScopeValues(sourceScope.districts),
        metadata.district,
        ...schools.map((school) => school.district),
      ]),
      sub_districts: uniqueStrings([
        ...this.normalizeScopeValues(sourceScope.sub_districts),
        metadata.subDistrict,
        ...schools.map((school) => school.sub_district),
      ]),
      school_ids: schoolIds,
      grade_levels: this.normalizeScopeValues([
        ...this.normalizeScopeValues(sourceScope.grade_levels),
        ...(metadata.gradeLevelId !== null && metadata.gradeLevelId !== undefined
          ? [metadata.gradeLevelId as string | number]
          : metadata.grade !== null && metadata.grade !== undefined
            ? [metadata.grade as string | number]
            : []),
      ]),
      room_ids: this.normalizeScopeValues([
        ...this.normalizeScopeValues(sourceScope.room_ids),
        ...(metadata.roomId !== null && metadata.roomId !== undefined
          ? [metadata.roomId as string | number]
          : metadata.room !== null && metadata.room !== undefined
            ? [metadata.room as string | number]
            : []),
      ]),
      own_only: sourceScope.own_only === true ? true : undefined,
    };
    const compactScope = Object.fromEntries(
      Object.entries(scope).filter(([, value]) =>
        Array.isArray(value) ? value.length > 0 : value === true,
      ),
    );

    return Object.keys(compactScope).length > 0 ? { ...metadata, scope: compactScope } : metadata;
  }

  private assertDomainPermission(actor: AuthenticatedRequestUser, domain: AuditLogDomain): void {
    const allowed = DOMAIN_PERMISSIONS[domain].some((permission) =>
      hasPermission(actor.roles, actor.permissions, permission),
    );
    if (!allowed || actor.data_scope?.own_only === true) {
      throw new ForbiddenException('ไม่มีสิทธิ์ดูประวัติส่วนนี้');
    }
  }

  private appendScopeConditions(
    conditions: string[],
    params: unknown[],
    actorScope: DataScope | undefined,
  ): void {
    const scopeSql = `COALESCE(a.metadata -> 'scope', '{}'::jsonb)`;
    const appendSubset = (key: keyof Omit<DataScope, 'own_only'>, values: unknown): void => {
      const normalized = this.normalizeScopeValues(values).map(String);
      if (normalized.length === 0) {
        return;
      }
      params.push(normalized);
      const parameter = `$${params.length}`;
      conditions.push(`
        jsonb_typeof(${scopeSql} -> '${key}') = 'array'
        AND jsonb_array_length(${scopeSql} -> '${key}') > 0
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(${scopeSql} -> '${key}') AS event_scope(value)
          WHERE NOT (event_scope.value = ANY(${parameter}::text[]))
        )
      `);
    };

    appendSubset('provinces', actorScope?.provinces);
    appendSubset('districts', actorScope?.districts);
    appendSubset('sub_districts', actorScope?.sub_districts);
    appendSubset('school_ids', actorScope?.school_ids);
    appendSubset('grade_levels', actorScope?.grade_levels);
    appendSubset('room_ids', actorScope?.room_ids);
  }

  private async assertSchoolFilterAllowed(
    actor: AuthenticatedRequestUser,
    schoolId: number | undefined,
  ): Promise<void> {
    if (!schoolId) {
      return;
    }
    const actorScope = actor.data_scope || {};
    const hasRestriction =
      this.normalizeScopeValues(actorScope.provinces).length > 0 ||
      this.normalizeScopeValues(actorScope.districts).length > 0 ||
      this.normalizeScopeValues(actorScope.sub_districts).length > 0 ||
      this.normalizeScopeValues(actorScope.school_ids).length > 0;
    if (!hasRestriction) {
      return;
    }

    const school = (
      await queryDataSource<SchoolScopeRow>(
        this.dataSource,
        `SELECT id, province, district, sub_district FROM schools WHERE id = $1`,
        [schoolId],
      )
    ).rows[0];
    const contains = (allowed: unknown, value: unknown): boolean => {
      const values = this.normalizeScopeValues(allowed).map(String);
      if (values.length === 0) {
        return true;
      }
      if (typeof value !== 'string' && typeof value !== 'number') {
        return false;
      }
      return values.includes(String(value));
    };
    if (
      !school ||
      !contains(actorScope.provinces, school.province) ||
      !contains(actorScope.districts, school.district) ||
      !contains(actorScope.sub_districts, school.sub_district) ||
      !contains(actorScope.school_ids, school.id)
    ) {
      throw new ForbiddenException('โรงเรียนอยู่นอกขอบเขตข้อมูลของผู้ใช้');
    }
  }

  private toSafeDetails(
    definition: AuditActionDefinition,
    metadata: Record<string, unknown> | null,
  ): Array<{ label: string; value: string | number }> {
    if (!metadata) {
      return [];
    }

    return definition.detailKeys.flatMap(({ key, label }) => {
      const value = metadata[key];
      return typeof value === 'string' || typeof value === 'number' ? [{ label, value }] : [];
    });
  }

  private toAuditLogEntry(row: AuditLogRow): AuditLogEntryResponse {
    const definition = ACTION_DEFINITIONS[row.action];
    return {
      id: String(row.id),
      domain: definition.domain,
      action: row.action,
      actionLabel: definition.label,
      actorLabel: row.actor_label || 'ระบบ',
      targetType: row.target_type,
      targetId: row.target_id,
      createdAt:
        row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(String(row.created_at)).toISOString(),
      details: this.toSafeDetails(definition, row.metadata),
    };
  }

  async list(actor: AuthenticatedRequestUser, filters: AuditLogListFilters) {
    this.assertDomainPermission(actor, filters.domain);
    if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
      throw new BadRequestException('dateFrom ต้องไม่มากกว่า dateTo');
    }
    await this.assertSchoolFilterAllowed(actor, filters.schoolId);

    const actions = Object.entries(ACTION_DEFINITIONS)
      .filter(([, definition]) => definition.domain === filters.domain)
      .map(([action]) => action);
    if (filters.action && !actions.includes(filters.action)) {
      throw new BadRequestException('action ไม่ตรงกับประเภทประวัติ');
    }
    if (actions.length === 0) {
      return {
        data: [],
        meta: buildPaginationMeta(resolvePage(filters.page), resolveLimit(filters.limit), 0),
      };
    }

    const conditions: string[] = [];
    const params: unknown[] = [];
    params.push(filters.action ? [filters.action] : actions);
    conditions.push(`a.action = ANY($${params.length}::text[])`);
    conditions.push(
      `NOT (a.action = 'STUDENT_ACCOUNT_BULK_GENERATE' AND a.metadata ->> 'createdCount' = '0')`,
    );
    if (filters.domain === 'student_accounts') {
      conditions.push(`(
        COALESCE(
          NULLIF(a.metadata ->> 'scopeLabel', ''),
          NULLIF(a.metadata ->> 'province', ''),
          NULLIF(a.metadata ->> 'district', ''),
          NULLIF(a.metadata ->> 'subDistrict', ''),
          NULLIF(a.metadata ->> 'schoolId', ''),
          NULLIF(a.metadata ->> 'grade', ''),
          NULLIF(a.metadata ->> 'room', '')
        ) IS NOT NULL
        OR COALESCE(a.metadata -> 'scope', '{}'::jsonb) <> '{}'::jsonb
      )`);
    }
    if (filters.searchTerm) {
      params.push(`%${filters.searchTerm}%`);
      conditions.push(`(
        COALESCE(a.actor_label, '') ILIKE $${params.length}
        OR COALESCE(a.target_id, '') ILIKE $${params.length}
        OR a.action ILIKE $${params.length}
      )`);
    }
    if (filters.dateFrom) {
      params.push(filters.dateFrom);
      conditions.push(`a.created_at >= $${params.length}::date`);
    }
    if (filters.dateTo) {
      params.push(filters.dateTo);
      conditions.push(`a.created_at < ($${params.length}::date + INTERVAL '1 day')`);
    }
    const appendMetadataScopeFilter = (
      scopeKey: 'provinces' | 'districts' | 'sub_districts' | 'school_ids',
      metadataKey: 'province' | 'district' | 'subDistrict' | 'schoolId',
      value: string | undefined,
    ): void => {
      if (!value) {
        return;
      }
      params.push(value);
      const parameter = `$${params.length}`;
      const scopeArray = `CASE
        WHEN jsonb_typeof(a.metadata -> 'scope' -> '${scopeKey}') = 'array'
        THEN a.metadata -> 'scope' -> '${scopeKey}'
        ELSE '[]'::jsonb
      END`;
      conditions.push(`(
        a.metadata ->> '${metadataKey}' = ${parameter}
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(${scopeArray}) AS filter_scope(value)
          WHERE filter_scope.value = ${parameter}
        )
      )`);
    };
    appendMetadataScopeFilter('provinces', 'province', filters.province);
    appendMetadataScopeFilter('districts', 'district', filters.district);
    appendMetadataScopeFilter('sub_districts', 'subDistrict', filters.subDistrict);
    if (filters.schoolId) {
      params.push(String(filters.schoolId));
      const parameter = `$${params.length}`;
      conditions.push(`(
        a.metadata ->> 'schoolId' = ${parameter}
        OR EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(
            CASE
              WHEN jsonb_typeof(a.metadata -> 'scope' -> 'school_ids') = 'array'
              THEN a.metadata -> 'scope' -> 'school_ids'
              ELSE '[]'::jsonb
            END
          ) AS school_scope(value)
          WHERE school_scope.value = ${parameter}
        )
      )`);
    }
    this.appendScopeConditions(conditions, params, actor.data_scope);

    const page = resolvePage(filters.page);
    const limit = resolveLimit(filters.limit);
    params.push(limit);
    const limitParam = `$${params.length}`;
    params.push((page - 1) * limit);
    const offsetParam = `$${params.length}`;
    const result = await queryDataSource<AuditLogRow>(
      this.dataSource,
      `
        SELECT
          a.id,
          a.actor_label,
          a.action,
          a.target_type,
          a.target_id,
          a.metadata,
          a.created_at,
          COUNT(*) OVER() AS total_count
        FROM audit_log a
        WHERE ${conditions.join(' AND ')}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${limitParam}
        OFFSET ${offsetParam}
      `,
      params,
    );
    const totalCount = result.rows[0] ? Number(result.rows[0].total_count) || 0 : 0;

    return {
      data: result.rows.map((row) => this.toAuditLogEntry(row)),
      meta: buildPaginationMeta(page, limit, totalCount),
    };
  }

  async getById(actor: AuthenticatedRequestUser, id: string) {
    if (!/^\d+$/.test(id)) {
      throw new BadRequestException('id ไม่ถูกต้อง');
    }

    const found = (
      await queryDataSource<AuditLogRow>(
        this.dataSource,
        `
          SELECT
            a.id,
            a.actor_label,
            a.action,
            a.target_type,
            a.target_id,
            a.metadata,
            a.created_at,
            1 AS total_count
          FROM audit_log a
          WHERE a.id = $1::bigint
        `,
        [id],
      )
    ).rows[0];
    const definition = found ? ACTION_DEFINITIONS[found.action] : undefined;
    if (!found || !definition) {
      throw new NotFoundException('ไม่พบประวัติรายการนี้');
    }

    this.assertDomainPermission(actor, definition.domain);

    const conditions = [`a.id = $1::bigint`];
    const params: unknown[] = [id];
    if (definition.domain === 'student_accounts') {
      conditions.push(
        `NOT (a.action = 'STUDENT_ACCOUNT_BULK_GENERATE' AND a.metadata ->> 'createdCount' = '0')`,
      );
      conditions.push(`(
        COALESCE(
          NULLIF(a.metadata ->> 'scopeLabel', ''),
          NULLIF(a.metadata ->> 'province', ''),
          NULLIF(a.metadata ->> 'district', ''),
          NULLIF(a.metadata ->> 'subDistrict', ''),
          NULLIF(a.metadata ->> 'schoolId', ''),
          NULLIF(a.metadata ->> 'grade', ''),
          NULLIF(a.metadata ->> 'room', '')
        ) IS NOT NULL
        OR COALESCE(a.metadata -> 'scope', '{}'::jsonb) <> '{}'::jsonb
      )`);
    }
    this.appendScopeConditions(conditions, params, actor.data_scope);

    const scoped = (
      await queryDataSource<AuditLogRow>(
        this.dataSource,
        `
          SELECT
            a.id,
            a.actor_label,
            a.action,
            a.target_type,
            a.target_id,
            a.metadata,
            a.created_at,
            1 AS total_count
          FROM audit_log a
          WHERE ${conditions.join(' AND ')}
          LIMIT 1
        `,
        params,
      )
    ).rows[0];
    if (!scoped) {
      throw new NotFoundException('ไม่พบประวัติรายการนี้');
    }

    return { data: this.toAuditLogEntry(scoped) };
  }

  async record(event: AuditLogRecordInput): Promise<void> {
    try {
      const metadata = await this.addScopeSnapshot(event.metadata);
      await queryDataSource(
        this.dataSource,
        `
          INSERT INTO audit_log (
            actor_user_id,
            actor_label,
            action,
            target_type,
            target_id,
            metadata,
            ip
          )
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
        `,
        [
          event.actorUserId ?? null,
          event.actorLabel ?? null,
          event.action,
          event.targetType ?? null,
          event.targetId ?? null,
          metadata == null ? null : JSON.stringify(metadata),
          event.ip ?? null,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Audit log write failed for action "${event.action}": ${message}`);
    }
  }
}
