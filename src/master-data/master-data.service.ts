import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveLimit, resolvePage } from '../common/pagination/pagination.util';
import { UpsertMasterDataItemDto } from './dto/master-data.dto';
import { MasterDataRepository } from './master-data.repository';
import {
  getMasterDataValueColumn,
  isMasterDataTable,
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
