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
const IMPORT_PREVIEW_SAMPLE_LIMIT = 20;

const IMPORT_TARGET_LABELS: Record<ImportTarget, string> = {
  student_dropouts: 'ข้อมูลนักเรียนออกกลางคัน',
  student_term: 'ข้อมูลนักเรียนในระบบ (รายภาคเรียน)',
};

const REQUIRED_IMPORT_COLUMNS: Record<ImportTarget, readonly string[]> = {
  student_dropouts: ['PersonID_Onec'],
  student_term: ['PersonID_Onec'],
};

const RECOMMENDED_IMPORT_COLUMNS: Record<ImportTarget, readonly string[]> = {
  student_dropouts: ['SchoolID_Onec', 'GradeLevelID_Onec', 'RoomID_Onec'],
  student_term: [
    'AcademicYear_Onec',
    'Semester_Onec',
    'SchoolID_Onec',
    'GradeLevelID_Onec',
    'RoomID_Onec',
  ],
};

export interface ImportPreviewRow {
  rowNumber: number;
  status: 'ready' | 'skipped';
  issues: string[];
  personIdMasked: string;
  firstName: string;
  lastName: string;
  schoolId: string;
  academicYear: string;
  semester: string;
  gradeLevelId: string;
  roomId: string;
}

export interface ImportPreviewResult {
  target: ImportTarget;
  targetLabel: string;
  canImport: boolean;
  headers: string[];
  mapping: Record<string, string>;
  rowsProcessed: number;
  rowsReady: number;
  rowsSkipped: number;
  duplicateRows: number;
  existingRows: number;
  missingPersonIdRows: number;
  mappedColumns: string[];
  missingRequiredColumns: string[];
  missingRecommendedColumns: string[];
  unmappedHeaders: string[];
  sampleRows: ImportPreviewRow[];
}

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

  private stringifyIdentifierValue(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }

    return '';
  }

  private normalizeNationalId(value: unknown): string {
    return this.normalizeScalar(value).replace(/[^0-9]/g, '');
  }

  private maskIdentifier(value: unknown): string {
    const normalized = this.normalizeNationalId(value);
    if (normalized.length >= 4) {
      return `••••${normalized.slice(-4)}`;
    }

    return '-';
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

  private getTargetLabel(target: ImportTarget): string {
    return IMPORT_TARGET_LABELS[target] ?? target;
  }

  private getWorksheetHeaders(data: SheetRow[]): string[] {
    const headers = new Set<string>();
    for (const row of data) {
      for (const header of Object.keys(row)) {
        headers.add(header);
      }
    }

    return [...headers];
  }

  private resolveImportMapping(
    target: ImportTarget,
    mapping: Record<string, string>,
    data: SheetRow[],
  ): Record<string, string> {
    if (Object.keys(mapping).length > 0) {
      return mapping;
    }

    const headers = new Set(this.getWorksheetHeaders(data));
    const allowedColumns = IMPORT_TARGET_COLUMNS[target];
    return Object.fromEntries(
      [...allowedColumns].filter((column) => headers.has(column)).map((column) => [column, column]),
    );
  }

  private getUnmappedHeaders(
    target: ImportTarget,
    mapping: Record<string, string>,
    data: SheetRow[],
  ): string[] {
    const mappedHeaders = new Set(Object.values(mapping));
    const allowedColumns = IMPORT_TARGET_COLUMNS[target];
    return this.getWorksheetHeaders(data).filter(
      (header) => !mappedHeaders.has(header) && !allowedColumns.has(header),
    );
  }

  private buildImportDbRow(
    mapping: Record<string, string>,
    row: SheetRow,
  ): Record<string, unknown> {
    const dbRow: Record<string, unknown> = {};
    for (const dbCol of Object.keys(mapping)) {
      const csvHeader = mapping[dbCol];
      if (csvHeader && row[csvHeader] !== undefined) {
        dbRow[dbCol] = row[csvHeader];
      } else {
        dbRow[dbCol] = null;
      }
    }

    return dbRow;
  }

  private actorLabel(actor?: AuthenticatedRequestUser): string | null {
    const actorName = [actor?.FirstName, actor?.LastName].filter(Boolean).join(' ').trim();
    return actor?.username || actorName || null;
  }

  async checkMissingSchools(
    file: Express.Multer.File,
    mappingStr: string,
  ): Promise<{ missingSchools: Array<{ id: number }> }> {
    const parsedMapping = this.parseMapping(mappingStr);
    const data = this.readWorksheetRows(file);
    const mapping = this.resolveImportMapping('student_term', parsedMapping, data);

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

  async previewImport(
    file: Express.Multer.File,
    target: string,
    mappingStr: string,
  ): Promise<ImportPreviewResult> {
    const validTarget = this.parseTarget(target);
    const parsedMapping = this.parseMapping(mappingStr);
    const data = this.readWorksheetRows(file);

    if (!data || data.length === 0) {
      throw new BadRequestException('The uploaded file is empty or unreadable');
    }

    const mapping = this.resolveImportMapping(validTarget, parsedMapping, data);
    this.assertMappedColumnsAllowed(validTarget, mapping);

    const requiredColumns = REQUIRED_IMPORT_COLUMNS[validTarget];
    const recommendedColumns = RECOMMENDED_IMPORT_COLUMNS[validTarget];
    const missingRequiredColumns = requiredColumns.filter((column) => !mapping[column]);
    const missingRecommendedColumns = recommendedColumns.filter((column) => !mapping[column]);
    const personIdHeader = mapping['PersonID_Onec'];
    const rawPersonIds = data.map((row) =>
      personIdHeader ? this.normalizeScalar(row[personIdHeader]) : '',
    );
    const nonBlankPersonIds = rawPersonIds.filter((value) => value.length > 0);
    const existingPersonIds = new Set(
      await this.importsRepository.findExistingImportPersonIds(validTarget, [
        ...new Set(nonBlankPersonIds),
      ]),
    );
    const seenPersonIds = new Set<string>();

    let rowsReady = 0;
    let duplicateRows = 0;
    let existingRows = 0;
    let missingPersonIdRows = 0;

    const sampleRows: ImportPreviewRow[] = data
      .slice(0, IMPORT_PREVIEW_SAMPLE_LIMIT)
      .map((row, index) => {
        const dbRow = this.buildImportDbRow(mapping, row);
        const personId = this.normalizeScalar(dbRow['PersonID_Onec']);
        const issues: string[] = [];

        if (missingRequiredColumns.length > 0) {
          issues.push(`ไม่พบคอลัมน์บังคับ: ${missingRequiredColumns.join(', ')}`);
        }
        if (personId.length === 0) {
          issues.push('ไม่มี PersonID_Onec');
        } else if (seenPersonIds.has(personId)) {
          issues.push('ซ้ำในไฟล์เดียวกัน');
        } else if (existingPersonIds.has(personId)) {
          issues.push('มีอยู่ในระบบแล้ว จะถูกข้าม');
        }

        if (personId.length > 0) {
          seenPersonIds.add(personId);
        }

        return {
          rowNumber: index + 2,
          status: issues.length === 0 ? 'ready' : 'skipped',
          issues,
          personIdMasked: this.maskIdentifier(dbRow['PersonID_Onec']),
          firstName: this.normalizeScalar(dbRow['FirstName_Onec']) || '-',
          lastName: this.normalizeScalar(dbRow['LastName_Onec']) || '-',
          schoolId: this.normalizeScalar(dbRow['SchoolID_Onec']) || '-',
          academicYear: this.normalizeScalar(dbRow['AcademicYear_Onec']) || '-',
          semester: this.normalizeScalar(dbRow['Semester_Onec']) || '-',
          gradeLevelId: this.normalizeScalar(dbRow['GradeLevelID_Onec']) || '-',
          roomId: this.normalizeScalar(dbRow['RoomID_Onec']) || '-',
        };
      });

    seenPersonIds.clear();
    for (const personId of rawPersonIds) {
      if (missingRequiredColumns.length > 0 || personId.length === 0) {
        missingPersonIdRows++;
        continue;
      }
      if (seenPersonIds.has(personId)) {
        duplicateRows++;
        continue;
      }
      seenPersonIds.add(personId);
      if (existingPersonIds.has(personId)) {
        existingRows++;
        continue;
      }
      rowsReady++;
    }

    const rowsSkipped = data.length - rowsReady;

    return {
      target: validTarget,
      targetLabel: this.getTargetLabel(validTarget),
      canImport: missingRequiredColumns.length === 0 && rowsReady > 0,
      headers: this.getWorksheetHeaders(data),
      mapping,
      rowsProcessed: data.length,
      rowsReady,
      rowsSkipped,
      duplicateRows,
      existingRows,
      missingPersonIdRows,
      mappedColumns: Object.keys(mapping),
      missingRequiredColumns,
      missingRecommendedColumns,
      unmappedHeaders: this.getUnmappedHeaders(validTarget, mapping, data),
      sampleRows,
    };
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
    const parsedMapping = this.parseMapping(mappingStr);
    const manualSchools = this.parseManualSchools(schoolsStr);

    this.logger.log(`Parsing import file for target: ${validTarget}`);
    const data = this.readWorksheetRows(file);

    if (!data || data.length === 0) {
      throw new BadRequestException('The uploaded file is empty or unreadable');
    }

    const mapping = this.resolveImportMapping(validTarget, parsedMapping, data);
    this.assertMappedColumnsAllowed(validTarget, mapping);
    const missingRequiredColumns = REQUIRED_IMPORT_COLUMNS[validTarget].filter(
      (column) => !mapping[column],
    );
    if (missingRequiredColumns.length > 0) {
      throw new BadRequestException(`ไม่พบคอลัมน์บังคับ: ${missingRequiredColumns.join(', ')}`);
    }

    this.logger.log(`Found ${data.length} rows. Mapping to ${validTarget}...`);

    const result = await this.importsRepository.withTransaction(async (executor) => {
      for (const school of manualSchools) {
        await this.importsRepository.upsertManualSchool(school, executor);
      }

      let inserted = 0;
      let skipped = 0;

      for (const row of data) {
        const dbRow = this.buildImportDbRow(mapping, row);

        const personId = dbRow['PersonID_Onec'];
        if (this.normalizeScalar(personId).length === 0) {
          skipped++;
          continue;
        }

        dbRow['person_uuid'] = await this.importsRepository.resolveOrCreatePersonByNationalId(
          this.stringifyIdentifierValue(personId),
          this.normalizeNationalId(personId),
          executor,
        );

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
        target: this.getTargetLabel(validTarget),
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
