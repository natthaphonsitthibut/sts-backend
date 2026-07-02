import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveLimit, resolvePage } from '../common/pagination/pagination.util';
import { UpsertMasterDataItemDto } from './dto/master-data.dto';
import type { CodedMasterDataInput } from './master-data.repository';
import { MasterDataRepository } from './master-data.repository';
import {
  getMasterDataValueColumn,
  isCodedMasterDataTable,
  isMasterDataTable,
  type CodedMasterDataTable,
  type MasterDataTable,
} from './master-data.types';

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
