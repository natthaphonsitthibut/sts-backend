import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import * as xlsx from 'xlsx';
import { ImportsRepository } from './imports.repository';
import {
  isImportTarget,
  type ImportTarget,
  type ManualSchool,
  type SheetRow,
} from './imports.types';

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(private readonly importsRepository: ImportsRepository) {}

  private normalizeScalar(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value).trim();
    }

    return '';
  }

  private readWorksheetRows(file: Express.Multer.File): SheetRow[] {
    const workbook = xlsx.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return [];
    }

    return xlsx.utils.sheet_to_json<SheetRow>(workbook.Sheets[sheetName]);
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
  ) {
    const validTarget = this.parseTarget(target);
    const mapping = this.parseMapping(mappingStr);
    const manualSchools = this.parseManualSchools(schoolsStr);

    this.logger.log(`Parsing file: ${file.originalname} for target: ${validTarget}`);
    const data = this.readWorksheetRows(file);

    if (!data || data.length === 0) {
      throw new BadRequestException('The uploaded file is empty or unreadable');
    }

    this.logger.log(`Found ${data.length} rows. Mapping to ${validTarget}...`);

    const validDbColumns = Object.keys(mapping);

    return await this.importsRepository.withTransaction(async (executor) => {
      for (const school of manualSchools) {
        await this.importsRepository.upsertManualSchool(school, executor);
      }

      let inserted = 0;
      let skipped = 0;

      this.logger.log(`Using mapping: ${JSON.stringify(mapping)}`);
      if (data.length > 0) {
        this.logger.log(`First row parsed: ${JSON.stringify(data[0])}`);
      }

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

        await this.importsRepository.insertImportRow(validTarget, dbRow, executor);
        inserted++;
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
  }
}
