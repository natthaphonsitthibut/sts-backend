import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import type {
  CreateCodedMasterDataDto,
  CreateReferralAgencyDto,
  ListMasterDataQueryDto,
  UpdateCodedMasterDataDto,
  UpdateReferralAgencyDto,
} from './dto/master-data.dto';
import { MasterDataRepository } from './master-data.repository';
import {
  CODED_MASTER_DATA_CATALOGS,
  type CodedMasterDataCatalog,
  type CodedMasterDataRow,
  type ReferralAgencyRow,
} from './master-data.types';

const PROTECTED_CODES: Partial<Record<CodedMasterDataCatalog, ReadonlySet<string>>> = {
  'absence-reasons': new Set(['UNKNOWN']),
};

function databaseErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : null;
}

@Injectable()
export class MasterDataService {
  constructor(
    private readonly repository: MasterDataRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  resolveCatalog(value: string): CodedMasterDataCatalog {
    if ((CODED_MASTER_DATA_CATALOGS as readonly string[]).includes(value)) {
      return value as CodedMasterDataCatalog;
    }
    throw new NotFoundException('ไม่พบชุดข้อมูลพื้นฐาน');
  }

  private toCodedResponse(row: CodedMasterDataRow) {
    return {
      code: row.code,
      labelTh: row.label_th,
      sortOrder: row.sort_order,
      isActive: row.is_active,
      categoryCode: row.category_code,
      categoryLabelTh: row.category_label_th,
      sourceOnecCode: row.source_onec_code,
      requiresDetail: row.requires_detail,
      usageCount: row.usage_count,
    };
  }

  private toAgencyResponse(row: ReferralAgencyRow) {
    return {
      id: row.id,
      agencyName: row.agency_name,
      agencyKindCode: row.agency_kind_code,
      agencyKindLabelTh: row.agency_kind_label_th,
      contactPhone: row.contact_phone,
      contactEmail: row.contact_email,
      websiteUrl: row.website_url,
      isActive: row.is_active,
      usageCount: row.usage_count,
    };
  }

  async listCoded(catalogValue: string, query: ListMasterDataQueryDto) {
    const catalog = this.resolveCatalog(catalogValue);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const result = await this.repository.listCoded(catalog, {
      searchTerm: query.searchTerm?.trim() || undefined,
      includeInactive: query.includeInactive === true,
      limit,
      offset: (page - 1) * limit,
    });
    return {
      data: result.rows.map((row) => this.toCodedResponse(row)),
      meta: buildPaginationMeta(page, limit, result.totalCount),
    };
  }

  async listActiveOptions(catalog: CodedMasterDataCatalog) {
    const result = await this.repository.listCoded(catalog, {
      includeInactive: false,
      limit: 32767,
      offset: 0,
    });
    return result.rows
      .filter((row) => row.code !== 'NONE')
      .map((row) => ({
        code: row.code,
        labelTh: row.label_th,
        categoryCode: row.category_code,
        categoryLabelTh: row.category_label_th,
        requiresDetail: row.requires_detail,
      }));
  }

  private validateCodedValues(
    catalog: CodedMasterDataCatalog,
    values: {
      code: string;
      categoryCode?: string | null;
      sourceOnecCode?: number | null;
      requiresDetail?: boolean;
    },
  ): void {
    const definition = this.repository.getDefinition(catalog);
    if (definition.categoryColumn && values.code !== 'UNKNOWN' && !values.categoryCode) {
      throw new BadRequestException('สาเหตุการขาดต้องระบุประเภท');
    }
  }

  private validateSupportedFields(
    catalog: CodedMasterDataCatalog,
    values: {
      categoryCode?: string | null;
      sourceOnecCode?: number | null;
      requiresDetail?: boolean;
    },
  ): void {
    const definition = this.repository.getDefinition(catalog);
    if (!definition.categoryColumn && values.categoryCode !== undefined) {
      throw new BadRequestException('ชุดข้อมูลนี้ไม่รองรับประเภทอ้างอิง');
    }
    if (!definition.sourceColumn && values.sourceOnecCode !== undefined) {
      throw new BadRequestException('ชุดข้อมูลนี้ไม่รองรับรหัสต้นทาง ONEC');
    }
    if (!definition.requiresDetailColumn && values.requiresDetail !== undefined) {
      throw new BadRequestException('ชุดข้อมูลนี้ไม่รองรับเงื่อนไขรายละเอียด');
    }
  }

  async createCoded(
    actor: AuthenticatedRequestUser,
    catalogValue: string,
    dto: CreateCodedMasterDataDto,
  ) {
    const catalog = this.resolveCatalog(catalogValue);
    const code = dto.code.trim().toUpperCase();
    this.validateSupportedFields(catalog, dto);
    this.validateCodedValues(catalog, { ...dto, code });
    const actorId = resolveAuditActorId(actor);
    try {
      return await this.repository.withTransaction(async (runner) => {
        const definition = this.repository.getDefinition(catalog);
        if (definition.categoryCatalog && dto.categoryCode) {
          const category = await this.repository.findCoded(
            definition.categoryCatalog,
            dto.categoryCode,
            runner,
          );
          if (!category?.is_active) {
            throw new BadRequestException('ประเภทอ้างอิงถูกปิดใช้งานหรือไม่มีอยู่');
          }
        }
        await this.repository.createCoded(
          catalog,
          {
            code,
            labelTh: dto.labelTh.trim(),
            sortOrder: dto.sortOrder,
            isActive: true,
            categoryCode: dto.categoryCode ?? null,
            sourceOnecCode: dto.sourceOnecCode ?? null,
            requiresDetail: dto.requiresDetail,
            actorId,
          },
          runner,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: catalog,
            targetId: code,
            metadata: { op: 'create', changedFields: Object.keys(dto) },
            ip: null,
          },
          runner,
        );
        const created = await this.repository.findCoded(catalog, code, runner);
        return { data: this.toCodedResponse(created!) };
      });
    } catch (error) {
      if (databaseErrorCode(error) === '23505') {
        throw new ConflictException('รหัสหรือรหัสต้นทางนี้มีอยู่แล้ว');
      }
      if (databaseErrorCode(error) === '23503' || databaseErrorCode(error) === '23514') {
        throw new BadRequestException('ข้อมูลอ้างอิงไม่ถูกต้อง');
      }
      throw error;
    }
  }

  async updateCoded(
    actor: AuthenticatedRequestUser,
    catalogValue: string,
    codeValue: string,
    dto: UpdateCodedMasterDataDto,
  ) {
    const catalog = this.resolveCatalog(catalogValue);
    const code = codeValue.trim().toUpperCase();
    this.validateSupportedFields(catalog, dto);
    const actorId = resolveAuditActorId(actor);
    try {
      return await this.repository.withTransaction(async (runner) => {
        const existing = await this.repository.findCoded(catalog, code, runner);
        if (!existing) throw new NotFoundException('ไม่พบรายการข้อมูลพื้นฐาน');
        const definition = this.repository.getDefinition(catalog);
        if (
          definition.categoryCatalog &&
          dto.categoryCode !== undefined &&
          dto.categoryCode !== existing.category_code
        ) {
          const category = dto.categoryCode
            ? await this.repository.findCoded(definition.categoryCatalog, dto.categoryCode, runner)
            : null;
          if (!category?.is_active) {
            throw new BadRequestException('ประเภทอ้างอิงถูกปิดใช้งานหรือไม่มีอยู่');
          }
        }
        const values = {
          code,
          labelTh: dto.labelTh?.trim() ?? existing.label_th,
          sortOrder: dto.sortOrder ?? existing.sort_order,
          isActive: dto.isActive ?? existing.is_active,
          categoryCode: dto.categoryCode !== undefined ? dto.categoryCode : existing.category_code,
          sourceOnecCode:
            dto.sourceOnecCode !== undefined ? dto.sourceOnecCode : existing.source_onec_code,
          requiresDetail: dto.requiresDetail ?? existing.requires_detail ?? false,
          actorId,
        };
        this.validateCodedValues(catalog, values);
        if (PROTECTED_CODES[catalog]?.has(code) && !values.isActive) {
          throw new ConflictException('รายการระบบนี้ต้องเปิดใช้งานเสมอ');
        }
        await this.repository.updateCoded(catalog, code, values, runner);
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: catalog,
            targetId: code,
            metadata: { op: 'update', changedFields: Object.keys(dto) },
            ip: null,
          },
          runner,
        );
        const updated = await this.repository.findCoded(catalog, code, runner);
        return { data: this.toCodedResponse(updated!) };
      });
    } catch (error) {
      if (databaseErrorCode(error) === '23505') {
        throw new ConflictException('รหัสต้นทางนี้มีอยู่แล้ว');
      }
      if (databaseErrorCode(error) === '23503' || databaseErrorCode(error) === '23514') {
        throw new BadRequestException('ข้อมูลอ้างอิงไม่ถูกต้อง');
      }
      throw error;
    }
  }

  disableCoded(actor: AuthenticatedRequestUser, catalog: string, code: string) {
    return this.updateCoded(actor, catalog, code, { isActive: false });
  }

  async listReferralAgencies(query: ListMasterDataQueryDto) {
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const result = await this.repository.listReferralAgencies({
      searchTerm: query.searchTerm?.trim() || undefined,
      includeInactive: query.includeInactive === true,
      limit,
      offset: (page - 1) * limit,
    });
    return {
      data: result.rows.map((row) => this.toAgencyResponse(row)),
      meta: buildPaginationMeta(page, limit, result.totalCount),
    };
  }

  async createReferralAgency(actor: AuthenticatedRequestUser, dto: CreateReferralAgencyDto) {
    return this.writeReferralAgency(actor, null, dto);
  }

  async updateReferralAgency(
    actor: AuthenticatedRequestUser,
    id: number,
    dto: UpdateReferralAgencyDto,
  ) {
    return this.writeReferralAgency(actor, id, dto);
  }

  private async writeReferralAgency(
    actor: AuthenticatedRequestUser,
    id: number | null,
    dto: CreateReferralAgencyDto | UpdateReferralAgencyDto,
  ) {
    const actorId = resolveAuditActorId(actor);
    try {
      return await this.repository.withTransaction(async (runner) => {
        const existing = id === null ? null : await this.repository.findReferralAgency(id, runner);
        if (id !== null && !existing) throw new NotFoundException('ไม่พบหน่วยงานส่งต่อ');
        const requestedKind = dto.agencyKindCode ?? existing?.agency_kind_code ?? '';
        if (id === null || requestedKind !== existing?.agency_kind_code) {
          const kind = await this.repository.findCoded(
            'referral-agency-kinds',
            requestedKind,
            runner,
          );
          if (!kind?.is_active) {
            throw new BadRequestException('ประเภทหน่วยงานถูกปิดใช้งานหรือไม่มีอยู่');
          }
        }
        const values = {
          agencyName: dto.agencyName?.trim() ?? existing?.agency_name ?? '',
          agencyKindCode: requestedKind,
          contactPhone:
            dto.contactPhone !== undefined
              ? dto.contactPhone?.trim() || null
              : (existing?.contact_phone ?? null),
          contactEmail:
            dto.contactEmail !== undefined
              ? dto.contactEmail?.trim().toLowerCase() || null
              : (existing?.contact_email ?? null),
          websiteUrl:
            dto.websiteUrl !== undefined
              ? dto.websiteUrl?.trim() || null
              : (existing?.website_url ?? null),
          isActive: 'isActive' in dto ? (dto.isActive ?? existing?.is_active ?? true) : true,
          actorId,
        };
        const targetId =
          id === null
            ? await this.repository.createReferralAgency(values, runner)
            : (await this.repository.updateReferralAgency(id, values, runner), id);
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'MASTER_DATA_EDIT',
            targetType: 'referral-agencies',
            targetId: String(targetId),
            metadata: { op: id === null ? 'create' : 'update', changedFields: Object.keys(dto) },
            ip: null,
          },
          runner,
        );
        const updated = await this.repository.findReferralAgency(targetId, runner);
        return { data: this.toAgencyResponse(updated!) };
      });
    } catch (error) {
      if (databaseErrorCode(error) === '23503' || databaseErrorCode(error) === '23514') {
        throw new BadRequestException('ประเภทหรือข้อมูลหน่วยงานไม่ถูกต้อง');
      }
      throw error;
    }
  }

  disableReferralAgency(actor: AuthenticatedRequestUser, id: number) {
    return this.updateReferralAgency(actor, id, { isActive: false });
  }
}
