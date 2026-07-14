import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  hasAreaDataScope,
  isUnconfiguredDataScope,
  normalizeDataScope,
  type AuthenticatedRequestUser,
  type DataScope,
} from '../auth';
import { hasPermission } from '../auth/permissions.constants';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { resolveLimit, resolvePage } from '../common/pagination/pagination.util';
import { UpsertMasterDataItemDto } from './dto/master-data.dto';
import type {
  CreateSchoolMasterDataDto,
  UpdateSchoolMasterDataDto,
} from './dto/school-master-data.dto';
import type { CodedMasterDataInput } from './master-data.repository';
import { MasterDataRepository } from './master-data.repository';
import {
  getMasterDataValueColumn,
  isCodedMasterDataTable,
  isMasterDataTable,
  type CodedMasterDataTable,
  type MasterDataTable,
  type SchoolMasterDataInput,
  type SchoolMasterDataRow,
} from './master-data.types';

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

@Injectable()
export class MasterDataService {
  private readonly logger = new Logger(MasterDataService.name);

  constructor(
    private readonly masterDataRepository: MasterDataRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  private validateTableName(table: string): MasterDataTable {
    if (!isMasterDataTable(table)) {
      this.logger.warn(`Rejected invalid master-data table: ${table}`);
      throw new BadRequestException('Invalid master data table');
    }

    return table;
  }

  private resolveValue(data: UpsertMasterDataItemDto): string {
    const rawValue =
      typeof data.label === 'string' && data.label.trim().length > 0 ? data.label : data.name;

    if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
      throw new BadRequestException('Master data value is required');
    }

    return rawValue.trim();
  }

  private cleanOptionalText(value: string | null | undefined): string | null | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (value === null) {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private resolveCodedData(
    table: CodedMasterDataTable,
    data: UpsertMasterDataItemDto,
  ): CodedMasterDataInput {
    const code = typeof data.code === 'string' ? data.code.trim() : '';
    const name = typeof data.name === 'string' ? data.name.trim() : '';

    if (!code || !name) {
      throw new BadRequestException('Master data code and name are required');
    }

    const resolved: CodedMasterDataInput = {
      code,
      name,
      note: this.cleanOptionalText(data.note),
      is_active: data.is_active,
    };

    if (table === 'disability_types') {
      resolved.legal_category = this.cleanOptionalText(data.legal_category);
    }
    if (table === 'absence_reasons') {
      const categoryId = data.category_id;
      if (typeof categoryId !== 'number' || !Number.isInteger(categoryId) || categoryId < 1) {
        throw new BadRequestException('Absence reason category is required');
      }
      resolved.category_id = categoryId;
    }

    return resolved;
  }

  private resolveSchoolScope(actor: AuthenticatedRequestUser): DataScope {
    if (!hasPermission(actor.roles, actor.permissions, 'manage-schools')) {
      throw new ForbiddenException('ไม่มีสิทธิ์จัดการข้อมูลโรงเรียน');
    }
    const scope = normalizeDataScope(actor.data_scope) ?? {};
    if (
      scope.own_only === true ||
      isUnconfiguredDataScope(scope) ||
      (scope.grade_levels?.length ?? 0) > 0 ||
      (scope.room_ids?.length ?? 0) > 0
    ) {
      throw new ForbiddenException('ขอบเขตบัญชีไม่อนุญาตให้จัดการข้อมูลระดับโรงเรียน');
    }
    return scope;
  }

  private assertGlobalSchoolManagement(scope: DataScope): void {
    if (scope.global !== true || hasAreaDataScope(scope)) {
      throw new ForbiddenException('การสร้างหรือปิดใช้งานโรงเรียนต้องใช้ขอบเขตทั้งระบบ');
    }
  }

  private toSchoolResponse(row: SchoolMasterDataRow) {
    return {
      id: row.id,
      name: row.name,
      province: row.province,
      district: row.district,
      subDistrict: row.sub_district,
      schoolStatus: row.school_status,
    };
  }

  private cleanSchoolText(value: string | undefined): string | null {
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : null;
  }

  private schoolInput(
    dto: CreateSchoolMasterDataDto | UpdateSchoolMasterDataDto,
    existing?: SchoolMasterDataRow,
  ): SchoolMasterDataInput {
    const name = dto.name?.trim() ?? existing?.name ?? '';
    if (!name) {
      throw new BadRequestException('School name is required');
    }
    return {
      name,
      province:
        dto.province === undefined
          ? (existing?.province ?? null)
          : this.cleanSchoolText(dto.province),
      district:
        dto.district === undefined
          ? (existing?.district ?? null)
          : this.cleanSchoolText(dto.district),
      subDistrict:
        dto.subDistrict === undefined
          ? (existing?.sub_district ?? null)
          : this.cleanSchoolText(dto.subDistrict),
    };
  }

  async listSchools(
    actor: AuthenticatedRequestUser,
    query: { page?: number; limit?: number; searchTerm?: string } = {},
  ) {
    const scope = this.resolveSchoolScope(actor);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const { rows, totalCount } = await this.masterDataRepository.listSchools(
      {
        page,
        limit,
        searchTerm: query.searchTerm?.trim() || undefined,
      },
      scope,
    );
    return {
      rows: rows.map((row) => this.toSchoolResponse(row)),
      totalCount,
      page,
      limit,
    };
  }

  async getSchool(actor: AuthenticatedRequestUser, id: number) {
    const row = await this.masterDataRepository.findSchoolById(id, this.resolveSchoolScope(actor));
    if (!row) {
      throw new NotFoundException('ไม่พบโรงเรียนในขอบเขตของคุณ');
    }
    return this.toSchoolResponse(row);
  }

  async createSchool(actor: AuthenticatedRequestUser, dto: CreateSchoolMasterDataDto) {
    const scope = this.resolveSchoolScope(actor);
    this.assertGlobalSchoolManagement(scope);
    const actorId = resolveAuditActorId(actor);
    try {
      return await this.masterDataRepository.withTransaction(async (queryRunner) => {
        const row = await this.masterDataRepository.createSchool(
          dto.id,
          this.schoolInput(dto),
          actorId,
          queryRunner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'schools',
            targetId: String(row.id),
            metadata: { op: 'create', changedFields: Object.keys(dto) },
            ip: null,
          },
          queryRunner,
        );
        return this.toSchoolResponse(row);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('รหัสโรงเรียนนี้มีอยู่แล้ว');
      }
      throw error;
    }
  }

  async updateSchool(actor: AuthenticatedRequestUser, id: number, dto: UpdateSchoolMasterDataDto) {
    const scope = this.resolveSchoolScope(actor);
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('At least one school field is required');
    }
    const actorId = resolveAuditActorId(actor);
    return await this.masterDataRepository.withTransaction(async (queryRunner) => {
      const existing = await this.masterDataRepository.findSchoolById(id, scope, queryRunner);
      if (!existing) {
        throw new NotFoundException('ไม่พบโรงเรียนในขอบเขตของคุณ');
      }
      const input = this.schoolInput(dto, existing);
      const row = await this.masterDataRepository.updateSchool(id, input, actorId, queryRunner);
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'MASTER_DATA_EDIT',
          targetType: 'schools',
          targetId: String(id),
          metadata: { op: 'update', changedFields: Object.keys(dto) },
          ip: null,
        },
        queryRunner,
      );
      return this.toSchoolResponse(row!);
    });
  }

  async disableSchool(actor: AuthenticatedRequestUser, id: number) {
    const scope = this.resolveSchoolScope(actor);
    this.assertGlobalSchoolManagement(scope);
    const actorId = resolveAuditActorId(actor);
    return await this.masterDataRepository.withTransaction(async (queryRunner) => {
      const existing = await this.masterDataRepository.findSchoolById(id, scope, queryRunner);
      if (!existing) {
        throw new NotFoundException('ไม่พบโรงเรียน');
      }
      const row = await this.masterDataRepository.disableSchool(id, actorId, queryRunner);
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'MASTER_DATA_EDIT',
          targetType: 'schools',
          targetId: String(id),
          metadata: { op: 'disable', changedFields: ['schoolStatus'] },
          ip: null,
        },
        queryRunner,
      );
      return this.toSchoolResponse(row!);
    });
  }

  async getAll(table: string, query: { page?: number; limit?: number; searchTerm?: string } = {}) {
    const validTable = this.validateTableName(table);

    if (query.page !== undefined) {
      const page = resolvePage(query.page);
      const limit = resolveLimit(query.limit);
      const { rows, totalCount } = await this.masterDataRepository.listRowsPaginated(validTable, {
        page,
        limit,
        searchTerm: query.searchTerm?.trim() || undefined,
      });

      return {
        rows,
        totalCount,
        page,
        limit,
      };
    }

    return await this.masterDataRepository.listRows(validTable);
  }

  async getById(table: string, id: number) {
    const validTable = this.validateTableName(table);
    return await this.masterDataRepository.findRowById(validTable, id);
  }

  async create(table: string, data: UpsertMasterDataItemDto) {
    const validTable = this.validateTableName(table);
    if (isCodedMasterDataTable(validTable)) {
      const row = await this.masterDataRepository.createCodedRow(
        validTable,
        this.resolveCodedData(validTable, data),
      );
      await this.auditLog.record({
        action: 'MASTER_DATA_EDIT',
        targetType: validTable,
        targetId: row?.id == null ? null : String(row.id),
        metadata: { op: 'create' },
        ip: null,
      });

      return row;
    }

    const value = this.resolveValue(data);
    const valueColumn = getMasterDataValueColumn(validTable);

    const row = await this.masterDataRepository.createRow(validTable, valueColumn, value);
    await this.auditLog.record({
      action: 'MASTER_DATA_EDIT',
      targetType: validTable,
      targetId: row?.id == null ? null : String(row.id),
      metadata: { op: 'create' },
      ip: null,
    });

    return row;
  }

  async update(table: string, id: number, data: UpsertMasterDataItemDto) {
    const validTable = this.validateTableName(table);
    if (isCodedMasterDataTable(validTable)) {
      const row = await this.masterDataRepository.updateCodedRow(
        validTable,
        id,
        this.resolveCodedData(validTable, data),
      );
      await this.auditLog.record({
        action: 'MASTER_DATA_EDIT',
        targetType: validTable,
        targetId: String(id),
        metadata: { op: 'update' },
        ip: null,
      });

      return row;
    }

    const value = this.resolveValue(data);
    const valueColumn = getMasterDataValueColumn(validTable);

    const row = await this.masterDataRepository.updateRow(validTable, id, valueColumn, value);
    await this.auditLog.record({
      action: 'MASTER_DATA_EDIT',
      targetType: validTable,
      targetId: String(id),
      metadata: { op: 'update' },
      ip: null,
    });

    return row;
  }

  async remove(table: string, id: number) {
    const validTable = this.validateTableName(table);
    const row = await this.masterDataRepository.deleteRow(validTable, id);
    await this.auditLog.record({
      action: 'MASTER_DATA_EDIT',
      targetType: validTable,
      targetId: String(id),
      metadata: { op: 'delete' },
      ip: null,
    });

    return row;
  }
}
