import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as xlsx from 'xlsx';
import type { AuthenticatedRequestUser } from '../auth';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { isXlsxBuffer, looksLikeTextBuffer } from '../common/file-upload/file-signature.util';
import { ImportsRepository } from './imports.repository';
import {
  IMPORT_TARGET_COLUMNS,
  isImportTarget,
  type ImportTarget,
  type ManualSchool,
  type SheetRow,
} from './imports.types';

const MAX_IMPORT_ROWS = 10_000;

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly importsRepository: ImportsRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  private normalizeScalar(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value).trim();
    }

    return '';
  }

  private readWorksheetRows(file: Express.Multer.File): SheetRow[] {
    // Validate by content (magic bytes), not the client extension/MIME: a real
    // spreadsheet is a zip (xlsx) and a csv is text. Reject a binary payload
    // mislabeled as .csv/.xlsx before handing it to the parser.
    if (!isXlsxBuffer(file.buffer) && !looksLikeTextBuffer(file.buffer)) {
      throw new BadRequestException('ไฟล์ไม่ถูกต้อง (รองรับเฉพาะ .xlsx หรือ .csv)');
    }

    // Cap parsing work (sheetRows) and reject oversized sheets so a crafted file
    // cannot exhaust memory/CPU on the worker. sheet_to_json consumes the first
    // physical row as headers, so read MAX+2 physical rows (header + MAX+1 data)
    // to guarantee the `> MAX` check below fires instead of silently truncating.
    const workbook = xlsx.read(file.buffer, { type: 'buffer', sheetRows: MAX_IMPORT_ROWS + 2 });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return [];
    }

    const rows = xlsx.utils.sheet_to_json<SheetRow>(workbook.Sheets[sheetName]);
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`ไฟล์มีจำนวนแถวเกินกำหนด (สูงสุด ${MAX_IMPORT_ROWS} แถว)`);
    }

    return rows;
  }

  /**
   * Reject any mapped column that is not a known column of the target table.
   * Column names are interpolated into SQL identifiers downstream, so this is
   * the primary guard against identifier-based SQL injection.
   */
  private assertMappedColumnsAllowed(target: ImportTarget, mapping: Record<string, string>): void {
    const allowed = IMPORT_TARGET_COLUMNS[target];
    const invalid = Object.keys(mapping).filter((column) => !allowed.has(column));
    if (invalid.length > 0) {
      throw new BadRequestException(`พบคอลัมน์ที่ไม่อนุญาตสำหรับ ${target}: ${invalid.join(', ')}`);
    }
  }

  private parseMapping(mappingStr: string): Record<string, string> {
    try {
      const parsed = JSON.parse(mappingStr) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid');
      }

      return Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] =>
            typeof entry[0] === 'string' && typeof entry[1] === 'string',
        ),
      );
    } catch {
      throw new BadRequestException('Invalid JSON in mapping');
    }
  }

  private parseManualSchools(schoolsStr?: string): ManualSchool[] {
    if (!schoolsStr) {
      return [];
    }

    try {
      const parsed = JSON.parse(schoolsStr) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('invalid');
      }

      return parsed.map((item) => {
        if (!item || typeof item !== 'object') {
          throw new Error('invalid');
        }

        const source = item as Record<string, unknown>;
        const id = Number(source.id);
        const name = typeof source.name === 'string' ? source.name.trim() : '';

        if (!Number.isInteger(id) || name.length === 0) {
          throw new Error('invalid');
        }

        return {
          id,
          name,
          province: typeof source.province === 'string' ? source.province : undefined,
          district: typeof source.district === 'string' ? source.district : undefined,
          sub_district: typeof source.sub_district === 'string' ? source.sub_district : undefined,
        };
      });
    } catch {
      throw new BadRequestException('Invalid JSON in schools');
    }
  }

  private parseTarget(target: string): ImportTarget {
    if (!isImportTarget(target)) {
      throw new BadRequestException('Invalid target database');
    }

    return target;
  }

  private actorLabel(actor?: AuthenticatedRequestUser): string | null {
    const actorName = [actor?.FirstName, actor?.LastName].filter(Boolean).join(' ').trim();
    return actor?.username || actorName || null;
  }

  async checkMissingSchools(
    file: Express.Multer.File,
    mappingStr: string,
  ): Promise<{ missingSchools: Array<{ id: number }> }> {
    const mapping = this.parseMapping(mappingStr);
    const data = this.readWorksheetRows(file);

    const schoolIdCsvHeader = mapping['SchoolID_Onec'];
    if (!schoolIdCsvHeader) {
      return { missingSchools: [] };
    }

    const uniqueSchoolIds = [
      ...new Set(
        data
          .map((row) => row[schoolIdCsvHeader])
          .filter(
            (value): value is string | number =>
              value !== null && value !== undefined && this.normalizeScalar(value).length > 0,
          )
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value)),
      ),
    ];
    if (uniqueSchoolIds.length === 0) {
      return { missingSchools: [] };
    }

    const existingIds = new Set(
      await this.importsRepository.findExistingSchoolIds(uniqueSchoolIds),
    );
    const missingIds = uniqueSchoolIds.filter((id) => !existingIds.has(id));

    return { missingSchools: missingIds.map((id) => ({ id: Number(id) })) };
  }

  async processImport(
    file: Express.Multer.File,
    target: string,
    mappingStr: string,
    schoolsStr?: string,
    actor?: AuthenticatedRequestUser,
    auditMeta: { ip?: string | null } = {},
  ) {
    const validTarget = this.parseTarget(target);
    const mapping = this.parseMapping(mappingStr);
    this.assertMappedColumnsAllowed(validTarget, mapping);
    const manualSchools = this.parseManualSchools(schoolsStr);

    this.logger.log(`Parsing import file for target: ${validTarget}`);
    const data = this.readWorksheetRows(file);

    if (!data || data.length === 0) {
      throw new BadRequestException('The uploaded file is empty or unreadable');
    }

    this.logger.log(`Found ${data.length} rows. Mapping to ${validTarget}...`);

    const validDbColumns = Object.keys(mapping);

    const result = await this.importsRepository.withTransaction(async (executor) => {
      for (const school of manualSchools) {
        await this.importsRepository.upsertManualSchool(school, executor);
      }

      let inserted = 0;
      let skipped = 0;

      for (const row of data) {
        const dbRow: Record<string, unknown> = {};

        for (const dbCol of validDbColumns) {
          const csvHeader = mapping[dbCol];
          if (csvHeader && row[csvHeader] !== undefined) {
            dbRow[dbCol] = row[csvHeader];
          } else {
            dbRow[dbCol] = null;
          }
        }

        const personId = dbRow['PersonID_Onec'];
        if (this.normalizeScalar(personId).length === 0) {
          skipped++;
          continue;
        }

        const rowCount = await this.importsRepository.insertImportRow(validTarget, dbRow, executor);
        if (rowCount > 0) {
          inserted++;
        } else {
          skipped++;
        }
      }

      this.logger.log(
        `Successfully completed import of ${inserted} rows into ${validTarget} (skipped: ${skipped})`,
      );
      return {
        success: true,
        rowsProcessed: data.length,
        rowsInserted: inserted,
        rowsSkipped: skipped,
      };
    });
    await this.auditLog.record({
      actorUserId: resolveAuditActorId(actor),
      actorLabel: this.actorLabel(actor),
      action: 'DATA_IMPORT',
      targetType: 'import',
      targetId: null,
      metadata: {
        rowCount: result.rowsProcessed,
        rowsInserted: result.rowsInserted,
        rowsSkipped: result.rowsSkipped,
        manualSchools: manualSchools.length,
      },
      ip: auditMeta.ip ?? null,
    });

    return result;
  }
}
