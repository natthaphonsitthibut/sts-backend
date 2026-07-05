import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'crypto';
import * as xlsx from 'xlsx';
import type { AuthenticatedRequestUser } from '../auth';
import { isUnconfiguredDataScope } from '../auth/auth.types';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { NotificationsService } from '../notifications/notifications.service';
import { isXlsxBuffer, looksLikeTextBuffer } from '../common/file-upload/file-signature.util';
import { ImportsRepository, type QuarantineLookupRow } from './imports.repository';
import type {
  ExportImportQuarantineDto,
  FixImportQuarantineDto,
  ListImportQuarantineDto,
  ResolveImportQuarantineDto,
  RetryImportQuarantineDto,
} from './dto/imports.dto';
import {
  DERIVED_IMPORT_COLUMNS,
  IMPORT_TARGET_COLUMNS,
  isImportTarget,
  type ImportQuarantineReason,
  type ImportReferenceRow,
  type ImportTarget,
  type ManualSchool,
  type QueryExecutor,
  type SheetRow,
} from './imports.types';

const MAX_IMPORT_ROWS = 10_000;
const IMPORT_PREVIEW_SAMPLE_LIMIT = 20;
const QUARANTINE_RETRY_BATCH_LIMIT = 100;

// Interim retention (owner-approved 2026-07-05): resolved/rejected quarantine
// rows hold minor PII, so purge them 180 days after resolution. PENDING rows are
// kept until worked, and the immutable audit_log is preserved. Replace with the
// full PDPA retention matrix when it lands.
const QUARANTINE_RETENTION_DAYS = 180;
const QUARANTINE_RETENTION_CRON = '0 45 3 * * *';

const PREVIEW_CHANGE_FIELDS: ReadonlyArray<{ column: string; label: string }> = [
  { column: 'FirstName_Onec', label: 'ชื่อ' },
  { column: 'LastName_Onec', label: 'นามสกุล' },
  { column: 'GradeLevelID_Onec', label: 'ชั้นเรียน' },
  { column: 'RoomID_Onec', label: 'ห้อง' },
  { column: 'StudentStatusID_Onec', label: 'สถานะนักเรียน' },
];

const IMPORT_TARGET_LABELS: Record<ImportTarget, string> = {
  student_dropouts: 'ข้อมูลนักเรียนออกกลางคัน',
  student_term: 'ข้อมูลนักเรียนในระบบ (รายภาคเรียน)',
};

const STUDENT_TERM_HEADER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  PersonID_Onec: [
    'id',
    'student id',
    'studentid',
    'national id',
    'citizen id',
    'เลขประจำตัว',
    'เลขประจำตัวประชาชน',
    'เลขบัตรประชาชน',
    'เลขบัตร',
    'รหัสนักเรียน',
  ],
  FullName_Onec: [
    'full name',
    'fullname',
    'ชื่อ-นามสกุล',
    'ชื่อนามสกุล',
    'ชื่อสกุล',
    'ชื่อและนามสกุล',
  ],
  FirstName_Onec: ['first name', 'firstname', 'ชื่อ'],
  LastName_Onec: ['last name', 'lastname', 'นามสกุล', 'สกุล'],
  AcademicYear_Onec: ['academic year', 'academicyear', 'ปีการศึกษา', 'ปี'],
  Semester_Onec: ['semester', 'term', 'ภาคเรียน', 'เทอม'],
  SchoolID_Onec: ['school id', 'schoolid', 'รหัสโรงเรียน', 'รหัสสถานศึกษา', 'โรงเรียน'],
  GradeLevelID_Onec: ['grade id', 'grade', 'ชั้นเรียน', 'ชั้น'],
  RoomID_Onec: ['room id', 'room', 'ห้องเรียน', 'ห้อง'],
  StudentStatusID_Onec: ['student status', 'status', 'สถานะนักเรียน', 'สถานะ'],
};

const RETRYABLE_QUARANTINE_REASONS: ReadonlySet<string> = new Set([
  'MISSING_NATURAL_KEY_FIELD',
  'UNMAPPED_STUDENT_STATUS',
  'SCHOOL_NOT_FOUND',
  'GRADE_NOT_FOUND',
  'ROOM_NOT_FOUND',
  'STATUS_CAUSE_UNMAPPED',
]);

const QUARANTINE_FIELD_LABELS_TH: Readonly<Record<string, string>> = {
  AcademicYear_Onec: 'ปีการศึกษา',
  Semester_Onec: 'ภาคเรียน',
  SchoolID_Onec: 'โรงเรียน',
  GradeLevelID_Onec: 'ชั้นเรียน',
  RoomID_Onec: 'ห้อง',
  StudentStatusID_Onec: 'สถานะนักเรียน',
};

type QuarantineBadgeVariant = 'default' | 'secondary' | 'destructive' | 'success' | 'warning';

interface QuarantineLookupMeta {
  label: string;
  variant?: QuarantineBadgeVariant;
}

interface QuarantineLookupContext {
  reason: Map<string, QuarantineLookupMeta>;
  resolution: Map<string, QuarantineLookupMeta>;
  status: Map<string, QuarantineLookupMeta>;
}

const QUARANTINE_EDITABLE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  MISSING_NATURAL_KEY_FIELD: ['AcademicYear_Onec', 'Semester_Onec', 'SchoolID_Onec'],
  UNMAPPED_STUDENT_STATUS: ['StudentStatusID_Onec'],
  SCHOOL_NOT_FOUND: ['SchoolID_Onec'],
  GRADE_NOT_FOUND: ['GradeLevelID_Onec'],
  ROOM_NOT_FOUND: ['RoomID_Onec'],
};

const REQUIRED_IMPORT_COLUMNS: Record<ImportTarget, readonly string[]> = {
  student_dropouts: ['PersonID_Onec'],
  student_term: ['PersonID_Onec', 'AcademicYear_Onec', 'Semester_Onec', 'SchoolID_Onec'],
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
  status: 'ready' | 'skipped' | 'quarantine';
  action: 'insert' | 'update' | 'skip' | 'quarantine';
  issues: string[];
  personIdMasked: string;
  firstName: string;
  lastName: string;
  schoolId: string;
  schoolName: string;
  academicYear: string;
  semester: string;
  gradeLevelId: string;
  gradeLabel: string;
  roomId: string;
  changedFields: string[];
  hasDifferentSchoolSnapshot: boolean;
  studentStatusCode: string;
  studentStatusLabel: string;
  studentStatusCategory: string;
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
  missingNaturalKeyRows: number;
  missingSchoolRows: number;
  gradeIssueRows: number;
  roomIssueRows: number;
  differentSchoolRows: number;
  missingSchools: Array<{ id: number }>;
  rowsToInsert: number;
  rowsToUpdate: number;
  rowsToQuarantine: number;
  mappedColumns: string[];
  mappedColumnSamples: Record<string, string[]>;
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
    private readonly notificationsService?: NotificationsService,
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

  private normalizePositiveInteger(value: unknown): string {
    const normalized = this.normalizeScalar(value);
    if (!/^\d+$/.test(normalized)) {
      return '';
    }
    const numericValue = Number(normalized);
    return Number.isSafeInteger(numericValue) && numericValue > 0 ? String(numericValue) : '';
  }

  private maskIdentifier(value: unknown): string {
    const normalized = this.normalizeNationalId(value);
    if (normalized.length >= 4) {
      return `••••${normalized.slice(-4)}`;
    }

    return '-';
  }

  private maskDocumentIdentifier(value: unknown): string {
    const normalized = this.normalizeScalar(value);
    return normalized.length >= 4 ? `••••${normalized.slice(-4)}` : '-';
  }

  private fingerprint(value: unknown): string {
    const normalized =
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          )
        : value;
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  private quarantineCandidateKey(quarantineRowId: string, personUuid: string): string {
    return createHash('sha256').update(`${quarantineRowId}:${personUuid}`).digest('hex');
  }

  private gradeRoomIssue(
    row: Record<string, unknown>,
    knownGradeIds: ReadonlySet<number>,
  ): ImportQuarantineReason | null {
    const gradeValue = this.normalizeScalar(row['GradeLevelID_Onec']);
    if (gradeValue) {
      const gradeId = this.normalizePositiveInteger(gradeValue);
      if (!gradeId || !knownGradeIds.has(Number(gradeId))) return 'GRADE_NOT_FOUND';
    }

    const roomValue = this.normalizeScalar(row['RoomID_Onec']);
    if (roomValue && !this.normalizePositiveInteger(roomValue)) return 'ROOM_NOT_FOUND';
    return null;
  }

  /**
   * Codes usable as a real student status for import. A placeholder row whose
   * category is UNMAPPED (e.g. seeded "ยังไม่ได้จับคู่") exists in master data but
   * must still be treated as not mapped, otherwise quarantined rows would
   * auto-pass retry without any correction.
   */
  private mappedStudentStatusCodes(statuses: ImportReferenceRow[]): Set<number> {
    return new Set(
      statuses
        .filter((status) => status.category !== 'UNMAPPED')
        .map((status) => Number(status.id)),
    );
  }

  private importStatusLabel(status?: {
    label?: string | null;
    category?: string | null;
  }): string | null {
    if (!status?.label || status.category === 'UNMAPPED') return null;
    return status.label.replace(/\s*\(ตัวอย่าง\)\s*$/u, '').trim() || status.label;
  }

  private quarantineChangedFieldDetails(
    changedFields: string[],
    originalValues: Record<string, unknown>,
    values: Record<string, unknown>,
  ) {
    return changedFields.map((field) => ({
      field,
      label: QUARANTINE_FIELD_LABELS_TH[field] ?? field,
      oldValue: this.normalizeScalar(originalValues[field]) || '-',
      newValue: this.normalizeScalar(values[field]) || '-',
    }));
  }

  private toChangedFieldDetails(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const detail = item as Record<string, unknown>;
      const label = this.normalizeScalar(detail.label);
      if (!label) return [];
      return [
        {
          label,
          oldValue: this.normalizeScalar(detail.oldValue) || '-',
          newValue: this.normalizeScalar(detail.newValue) || '-',
        },
      ];
    });
  }

  private toQuarantineLookupMap(rows: QuarantineLookupRow[]): Map<string, QuarantineLookupMeta> {
    return new Map(
      rows.map((row) => {
        const variant = this.normalizeScalar(row.badge_variant) as QuarantineBadgeVariant;
        return [
          String(row.code),
          {
            label: this.normalizeScalar(row.label_th) || String(row.code),
            ...(variant ? { variant } : {}),
          },
        ];
      }),
    );
  }

  private async quarantineLookupContext(
    executor?: QueryExecutor,
  ): Promise<QuarantineLookupContext> {
    if (executor) {
      const reasonRows = await this.importsRepository.findQuarantineReasonLookups(executor);
      const resolutionRows =
        await this.importsRepository.findQuarantineResolutionStateLookups(executor);
      const statusRows = await this.importsRepository.findQuarantineStatusLookups(executor);
      return {
        reason: this.toQuarantineLookupMap(reasonRows),
        resolution: this.toQuarantineLookupMap(resolutionRows),
        status: this.toQuarantineLookupMap(statusRows),
      };
    }
    const [reasonRows, resolutionRows, statusRows] = await Promise.all([
      this.importsRepository.findQuarantineReasonLookups(executor),
      this.importsRepository.findQuarantineResolutionStateLookups(executor),
      this.importsRepository.findQuarantineStatusLookups(executor),
    ]);
    return {
      reason: this.toQuarantineLookupMap(reasonRows),
      resolution: this.toQuarantineLookupMap(resolutionRows),
      status: this.toQuarantineLookupMap(statusRows),
    };
  }

  private quarantineLookup(
    lookups: Map<string, QuarantineLookupMeta>,
    code: string,
    fallbackVariant?: QuarantineBadgeVariant,
  ): QuarantineLookupMeta {
    const lookup = lookups.get(code);
    return {
      label: lookup?.label ?? code,
      variant: lookup?.variant ?? fallbackVariant,
    };
  }

  private missingStudentTermKeyFields(values: Record<string, unknown>): string[] {
    const fields: string[] = [];
    if (!this.normalizePositiveInteger(values['AcademicYear_Onec'])) {
      fields.push('AcademicYear_Onec');
    }
    if (!this.normalizePositiveInteger(values['Semester_Onec'])) {
      fields.push('Semester_Onec');
    }
    if (!this.normalizePositiveInteger(values['SchoolID_Onec'])) {
      fields.push('SchoolID_Onec');
    }
    return fields;
  }

  private applyCanonicalStudentStatus(
    row: Record<string, unknown>,
    knownStudentStatusCodes: ReadonlySet<number>,
  ): void {
    const statusCode = this.normalizePositiveInteger(row['StudentStatusID_Onec']);
    if (statusCode && knownStudentStatusCodes.has(Number(statusCode))) {
      row['student_status_code'] = Number(statusCode);
    }
  }

  private previewChangedFields(
    incoming: Record<string, unknown>,
    existing?: Record<string, unknown>,
  ): string[] {
    if (!existing) return [];
    return PREVIEW_CHANGE_FIELDS.filter(({ column }) => {
      const nextValue = this.normalizeScalar(incoming[column]);
      return nextValue.length > 0 && nextValue !== this.normalizeScalar(existing[column]);
    }).map(({ label }) => label);
  }

  private csvCell(value: unknown): string {
    const text = this.normalizeScalar(value);
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
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
    const derived = DERIVED_IMPORT_COLUMNS[target];
    const invalid = Object.keys(mapping).filter(
      (column) => !allowed.has(column) && !derived.has(column),
    );
    if (invalid.length > 0) {
      throw new BadRequestException(`พบคอลัมน์ที่ไม่อนุญาตสำหรับ ${target}: ${invalid.join(', ')}`);
    }
  }

  private normalizeHeader(value: string): string {
    return value
      .trim()
      .toLocaleLowerCase('th')
      .replace(/[\s_\-./()]+/g, '');
  }

  private assertUniqueMappedHeaders(mapping: Record<string, string>): void {
    const fieldsByHeader = new Map<string, string[]>();
    for (const [field, header] of Object.entries(mapping)) {
      const normalized = this.normalizeHeader(header);
      if (!normalized) continue;
      fieldsByHeader.set(normalized, [...(fieldsByHeader.get(normalized) ?? []), field]);
    }
    const duplicate = [...fieldsByHeader.entries()].find(([, fields]) => fields.length > 1);
    if (duplicate) {
      throw new BadRequestException(
        `คอลัมน์ “${duplicate[0]}” ถูกจับคู่มากกว่าหนึ่งช่อง กรุณาเลือกคอลัมน์แยกกัน`,
      );
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
      this.assertUniqueMappedHeaders(mapping);
      return mapping;
    }

    const headers = this.getWorksheetHeaders(data);
    const allowedColumns = IMPORT_TARGET_COLUMNS[target];
    const derivedColumns = DERIVED_IMPORT_COLUMNS[target];
    const candidates = [...allowedColumns, ...derivedColumns];
    const normalizedHeaders = new Map(
      headers.map((header) => [this.normalizeHeader(header), header]),
    );
    const usedHeaders = new Set<string>();
    const resolved: Record<string, string> = {};

    for (const column of candidates) {
      const aliases =
        target === 'student_term'
          ? [column, ...(STUDENT_TERM_HEADER_ALIASES[column] ?? [])]
          : [column];
      const header = aliases
        .map((alias) => normalizedHeaders.get(this.normalizeHeader(alias)))
        .find((value): value is string => typeof value === 'string' && !usedHeaders.has(value));
      if (header) {
        resolved[column] = header;
        usedHeaders.add(header);
      }
    }

    return resolved;
  }

  private getUnmappedHeaders(
    target: ImportTarget,
    mapping: Record<string, string>,
    data: SheetRow[],
  ): string[] {
    const mappedHeaders = new Set(Object.values(mapping));
    const allowedColumns = new Set([
      ...IMPORT_TARGET_COLUMNS[target],
      ...DERIVED_IMPORT_COLUMNS[target],
    ]);
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
      if (DERIVED_IMPORT_COLUMNS.student_term.has(dbCol)) continue;
      const csvHeader = mapping[dbCol];
      if (csvHeader && row[csvHeader] !== undefined) {
        const value = row[csvHeader];
        dbRow[dbCol] = typeof value === 'string' && value.trim().length === 0 ? null : value;
      } else {
        dbRow[dbCol] = null;
      }
    }

    const fullNameHeader = mapping['FullName_Onec'];
    const fullName = fullNameHeader ? this.normalizeScalar(row[fullNameHeader]) : '';
    if (fullName) {
      const parts = fullName.split(/\s+/u).filter(Boolean);
      if (!this.normalizeScalar(dbRow['FirstName_Onec'])) {
        dbRow['FirstName_Onec'] = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
      }
      if (!this.normalizeScalar(dbRow['LastName_Onec'])) {
        dbRow['LastName_Onec'] = parts.length > 1 ? parts.at(-1) : null;
      }
    }

    return dbRow;
  }

  private studentTermKey(row: Record<string, unknown>): string | null {
    const personId = this.normalizeNationalId(row['PersonID_Onec']);
    const academicYear = this.normalizePositiveInteger(row['AcademicYear_Onec']);
    const semester = this.normalizePositiveInteger(row['Semester_Onec']);
    const schoolId = this.normalizePositiveInteger(row['SchoolID_Onec']);
    if (!personId || !academicYear || !semester || !schoolId) {
      return null;
    }

    return JSON.stringify([personId, academicYear, semester, schoolId]);
  }

  private existingStudentTermKey(row: {
    person_id: string;
    academic_year: string;
    semester: string;
    school_id: string;
  }): string {
    return JSON.stringify([
      this.normalizeNationalId(row.person_id),
      this.normalizeScalar(row.academic_year),
      this.normalizeScalar(row.semester),
      this.normalizeScalar(row.school_id),
    ]);
  }

  private numericReferenceIds(data: SheetRow[], header?: string): number[] {
    if (!header) {
      return [];
    }

    return [
      ...new Set(data.map((row) => Number(row[header])).filter((value) => Number.isInteger(value))),
    ];
  }

  private mappedColumnSamples(
    mapping: Record<string, string>,
    data: SheetRow[],
  ): Record<string, string[]> {
    return Object.fromEntries(
      Object.entries(mapping).map(([column, header]) => {
        const values = [
          ...new Set(
            data
              .map((row) =>
                column === 'PersonID_Onec'
                  ? this.maskIdentifier(row[header])
                  : column === 'PassportNumber_Onec'
                    ? this.maskDocumentIdentifier(row[header])
                    : this.normalizeScalar(row[header]).slice(0, 80),
              )
              .filter((value) => value.length > 0 && value !== '-'),
          ),
        ].slice(0, 3);
        return [column, values];
      }),
    );
  }

  private actorLabel(actor?: AuthenticatedRequestUser): string | null {
    const actorName = [actor?.FirstName, actor?.LastName].filter(Boolean).join(' ').trim();
    return actor?.username || actorName || null;
  }

  private assertActorImportScope(
    actor: AuthenticatedRequestUser | undefined,
    rows: SheetRow[],
    mapping: Record<string, string>,
    schoolDetails: Array<{
      id: number;
      province: string | null;
      district: string | null;
      sub_district: string | null;
    }>,
  ): void {
    const scope = actor?.data_scope;
    if (!actor || !scope || scope.own_only || isUnconfiguredDataScope(scope)) {
      throw new ForbiddenException('บัญชีนี้ไม่มีขอบเขตสำหรับนำเข้าข้อมูลนักเรียน');
    }
    if (scope.global === true) return;

    const schools = new Map(schoolDetails.map((school) => [school.id, school]));
    const allowedSchoolIds = new Set((scope.school_ids ?? []).map(Number));
    const allowedProvinces = new Set(scope.provinces ?? []);
    const allowedDistricts = new Set(scope.districts ?? []);
    const allowedSubDistricts = new Set(scope.sub_districts ?? []);
    const allowedGrades = new Set((scope.grade_levels ?? []).map(Number));
    const allowedRooms = new Set((scope.room_ids ?? []).map(String));

    for (const row of rows) {
      const schoolId = Number(this.normalizePositiveInteger(row[mapping['SchoolID_Onec']]));
      if (!schoolId) {
        throw new ForbiddenException('ไม่สามารถยืนยันขอบเขตโรงเรียนของข้อมูลนำเข้า');
      }
      const school = schools.get(schoolId);
      const schoolAllowed =
        (allowedSchoolIds.size === 0 || allowedSchoolIds.has(schoolId)) &&
        (allowedProvinces.size === 0 ||
          (school?.province != null && allowedProvinces.has(school.province))) &&
        (allowedDistricts.size === 0 ||
          (school?.district != null && allowedDistricts.has(school.district))) &&
        (allowedSubDistricts.size === 0 ||
          (school?.sub_district != null && allowedSubDistricts.has(school.sub_district)));
      const grade = Number(this.normalizePositiveInteger(row[mapping['GradeLevelID_Onec']]));
      const room = this.normalizeScalar(row[mapping['RoomID_Onec']]);
      if (
        !schoolAllowed ||
        (allowedGrades.size > 0 && !allowedGrades.has(grade)) ||
        (allowedRooms.size > 0 && !allowedRooms.has(room))
      ) {
        throw new ForbiddenException(`ไม่มีสิทธิ์นำเข้าข้อมูลโรงเรียน ${schoolId}`);
      }
    }
  }

  async checkMissingSchools(
    file: Express.Multer.File,
    mappingStr: string,
    actor: AuthenticatedRequestUser,
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

    const schoolDetails = await this.importsRepository.findSchoolScopeDetails(uniqueSchoolIds);
    this.assertActorImportScope(actor, data, mapping, schoolDetails);

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
    actor: AuthenticatedRequestUser,
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
    const dbRows = data.map((row) => this.buildImportDbRow(mapping, row));
    const schoolIds = this.numericReferenceIds(data, mapping['SchoolID_Onec']);
    if (validTarget === 'student_term') {
      const schoolDetails = await this.importsRepository.findSchoolScopeDetails(schoolIds);
      this.assertActorImportScope(actor, data, mapping, schoolDetails);
    }
    const rawPersonIds = dbRows.map((row) =>
      validTarget === 'student_term'
        ? this.normalizeNationalId(row['PersonID_Onec'])
        : this.normalizeScalar(row['PersonID_Onec']),
    );
    const nonBlankPersonIds = rawPersonIds.filter((value) => value.length > 0);
    const uniquePersonIds = [...new Set(nonBlankPersonIds)];
    const conflictingNationalIds = new Set(
      validTarget === 'student_term'
        ? await this.importsRepository.findConflictingNationalIds(uniquePersonIds)
        : [],
    );
    const existingStudentTerms =
      validTarget === 'student_term'
        ? await this.importsRepository.findExistingStudentTerms(
            uniquePersonIds,
            actor.data_scope ?? {},
          )
        : [];
    const existingStudentTermKeys = new Set(
      existingStudentTerms.map((row) => this.existingStudentTermKey(row)),
    );
    const existingStudentTermsByKey = new Map(
      existingStudentTerms.map((row) => [this.existingStudentTermKey(row), row]),
    );
    const existingSchoolsByPersonTerm = new Map<string, Set<string>>();
    for (const row of existingStudentTerms) {
      const personTermKey = JSON.stringify([row.person_id, row.academic_year, row.semester]);
      const schools = existingSchoolsByPersonTerm.get(personTermKey) ?? new Set<string>();
      schools.add(row.school_id);
      existingSchoolsByPersonTerm.set(personTermKey, schools);
    }
    const existingPersonIds = new Set(
      validTarget === 'student_term'
        ? []
        : await this.importsRepository.findExistingImportPersonIds(validTarget, uniquePersonIds),
    );
    const gradeIds = this.numericReferenceIds(data, mapping['GradeLevelID_Onec']);
    const statusCodes = this.numericReferenceIds(data, mapping['StudentStatusID_Onec']);
    const [schools, grades, statuses] =
      validTarget === 'student_term'
        ? await Promise.all([
            this.importsRepository.findSchoolNames(schoolIds),
            this.importsRepository.findGradeLabels(gradeIds),
            this.importsRepository.findStudentStatusLabels(statusCodes),
          ])
        : [[], [], []];
    const schoolNames = new Map(schools.map((row) => [Number(row.id), row.label]));
    const missingSchools =
      validTarget === 'student_term'
        ? schoolIds.filter((schoolId) => !schoolNames.has(schoolId)).map((id) => ({ id }))
        : [];
    const gradeLabels = new Map(grades.map((row) => [Number(row.id), row.label]));
    const knownGradeIds = new Set(gradeLabels.keys());
    const statusLabels = new Map(statuses.map((row) => [Number(row.id), row]));
    const mappedStatusCodes = this.mappedStudentStatusCodes(statuses);
    const seenKeys = new Set<string>();

    let rowsReady = 0;
    let duplicateRows = 0;
    let existingRows = 0;
    let missingPersonIdRows = 0;
    let missingNaturalKeyRows = 0;
    let missingSchoolRows = 0;
    let gradeIssueRows = 0;
    let roomIssueRows = 0;
    let differentSchoolRows = 0;
    let rowsToInsert = 0;
    let rowsToUpdate = 0;
    let rowsToQuarantine = 0;

    const sampleRows: ImportPreviewRow[] = dbRows
      .slice(0, IMPORT_PREVIEW_SAMPLE_LIMIT)
      .map((dbRow, index) => {
        const personId = this.normalizeScalar(dbRow['PersonID_Onec']);
        const schoolId = this.normalizeScalar(dbRow['SchoolID_Onec']);
        const rowKey =
          validTarget === 'student_term'
            ? this.studentTermKey(dbRow)
            : this.normalizeScalar(dbRow['PersonID_Onec']) || null;
        const issues: string[] = [];
        let action: ImportPreviewRow['action'] = 'insert';
        let changedFields: string[] = [];
        let hasDifferentSchoolSnapshot = false;

        if (missingRequiredColumns.length > 0) {
          issues.push(`ไม่พบคอลัมน์บังคับ: ${missingRequiredColumns.join(', ')}`);
          action = 'quarantine';
        }
        if (personId.length === 0) {
          issues.push('ไม่มี PersonID_Onec');
          action = 'quarantine';
        } else if (!rowKey) {
          issues.push('ปีการศึกษา เทอม หรือโรงเรียนไม่ครบหรือรูปแบบไม่ถูกต้อง');
          action = 'quarantine';
        } else if (conflictingNationalIds.has(this.normalizeNationalId(personId))) {
          issues.push('พบรหัสประจำตัวผูกกับบุคคลมากกว่าหนึ่งคน');
          action = 'quarantine';
        } else if (validTarget === 'student_term' && !schoolNames.has(Number(schoolId))) {
          issues.push('ไม่พบโรงเรียนในข้อมูลหลัก');
        } else if (seenKeys.has(rowKey)) {
          issues.push('ซ้ำในไฟล์เดียวกัน');
          action = 'quarantine';
        } else if (existingStudentTermKeys.has(rowKey) || existingPersonIds.has(personId)) {
          if (validTarget === 'student_term') {
            changedFields = this.previewChangedFields(
              dbRow,
              existingStudentTermsByKey.get(rowKey)?.mutable_values,
            );
            issues.push(
              changedFields.length > 0
                ? `มีข้อมูลภาคเรียนนี้แล้ว จะอัปเดต: ${changedFields.join(', ')}`
                : 'มีข้อมูลภาคเรียนนี้แล้ว ไม่พบการเปลี่ยนแปลงในฟิลด์หลัก',
            );
            action = 'update';
          } else {
            issues.push('มีอยู่ในระบบแล้ว จะถูกข้าม');
            action = 'skip';
          }
        }

        if (rowKey) {
          seenKeys.add(rowKey);
        }

        const gradeLevelId = this.normalizeScalar(dbRow['GradeLevelID_Onec']);
        if (validTarget === 'student_term' && rowKey && action === 'insert') {
          const personTermKey = JSON.stringify([
            this.normalizeNationalId(personId),
            this.normalizePositiveInteger(dbRow['AcademicYear_Onec']),
            this.normalizePositiveInteger(dbRow['Semester_Onec']),
          ]);
          const schools = existingSchoolsByPersonTerm.get(personTermKey);
          hasDifferentSchoolSnapshot = Boolean(
            schools && !schools.has(this.normalizePositiveInteger(dbRow['SchoolID_Onec'])),
          );
          if (hasDifferentSchoolSnapshot) {
            issues.push('พบคน/ปี/เทอมเดียวกันในโรงเรียนอื่น ระบบจะสร้าง enrollment snapshot ใหม่');
          }
        }
        const studentStatusCode = this.normalizeScalar(dbRow['StudentStatusID_Onec']);
        const studentStatus = statusLabels.get(Number(studentStatusCode));
        if (studentStatusCode && !mappedStatusCodes.has(Number(studentStatusCode))) {
          issues.push('สถานะนักเรียนยังไม่ได้จับคู่');
          action = 'quarantine';
        }
        const gradeRoomIssue = this.gradeRoomIssue(dbRow, knownGradeIds);
        if (gradeRoomIssue === 'GRADE_NOT_FOUND') {
          issues.push('ชั้นเรียนไม่ถูกต้องหรือไม่พบในข้อมูลหลัก');
          action = 'quarantine';
        } else if (gradeRoomIssue === 'ROOM_NOT_FOUND') {
          issues.push('รหัสห้องต้องเป็นจำนวนเต็มบวก');
          action = 'quarantine';
        }

        return {
          rowNumber: index + 2,
          status: action === 'skip' ? 'skipped' : action === 'quarantine' ? 'quarantine' : 'ready',
          action,
          issues,
          personIdMasked: this.maskIdentifier(dbRow['PersonID_Onec']),
          firstName: this.normalizeScalar(dbRow['FirstName_Onec']) || '-',
          lastName: this.normalizeScalar(dbRow['LastName_Onec']) || '-',
          schoolId: schoolId || '-',
          schoolName: schoolNames.get(Number(schoolId)) ?? '-',
          academicYear: this.normalizeScalar(dbRow['AcademicYear_Onec']) || '-',
          semester: this.normalizeScalar(dbRow['Semester_Onec']) || '-',
          gradeLevelId: gradeLevelId || '-',
          gradeLabel: gradeLabels.get(Number(gradeLevelId)) ?? '-',
          roomId: this.normalizeScalar(dbRow['RoomID_Onec']) || '-',
          changedFields,
          hasDifferentSchoolSnapshot,
          studentStatusCode: studentStatusCode || '-',
          studentStatusLabel: this.importStatusLabel(studentStatus) ?? 'ยังไม่ได้จับคู่',
          studentStatusCategory: studentStatus?.category ?? 'UNMAPPED',
        };
      });

    seenKeys.clear();
    for (const [index, dbRow] of dbRows.entries()) {
      const personId = rawPersonIds[index];
      const rowKey = validTarget === 'student_term' ? this.studentTermKey(dbRow) : personId || null;
      if (personId.length === 0) {
        missingPersonIdRows += 1;
      }
      if (missingRequiredColumns.length > 0 || !rowKey) {
        rowsToQuarantine += 1;
        if (validTarget === 'student_term' && personId.length > 0) {
          missingNaturalKeyRows += 1;
        }
        continue;
      }
      if (conflictingNationalIds.has(personId)) {
        rowsToQuarantine += 1;
        continue;
      }
      const studentStatusCode = this.normalizeScalar(dbRow['StudentStatusID_Onec']);
      if (studentStatusCode && !mappedStatusCodes.has(Number(studentStatusCode))) {
        rowsToQuarantine += 1;
        continue;
      }
      const gradeRoomIssue = this.gradeRoomIssue(dbRow, knownGradeIds);
      if (gradeRoomIssue) {
        rowsToQuarantine += 1;
        if (gradeRoomIssue === 'GRADE_NOT_FOUND') gradeIssueRows += 1;
        if (gradeRoomIssue === 'ROOM_NOT_FOUND') roomIssueRows += 1;
        continue;
      }
      const schoolId = this.normalizePositiveInteger(dbRow['SchoolID_Onec']);
      if (validTarget === 'student_term' && !schoolNames.has(Number(schoolId))) {
        missingSchoolRows += 1;
      }
      if (seenKeys.has(rowKey)) {
        duplicateRows += 1;
        rowsToQuarantine += 1;
        continue;
      }
      seenKeys.add(rowKey);
      if (validTarget === 'student_term') {
        const personTermKey = JSON.stringify([
          personId,
          this.normalizePositiveInteger(dbRow['AcademicYear_Onec']),
          this.normalizePositiveInteger(dbRow['Semester_Onec']),
        ]);
        const existingSchools = existingSchoolsByPersonTerm.get(personTermKey);
        if (existingSchools && !existingSchools.has(schoolId)) differentSchoolRows += 1;
      }
      if (existingStudentTermKeys.has(rowKey)) {
        existingRows += 1;
        rowsToUpdate += 1;
        rowsReady += 1;
        continue;
      }
      if (existingPersonIds.has(personId)) {
        existingRows += 1;
        continue;
      }
      rowsToInsert += 1;
      rowsReady += 1;
    }

    const rowsSkipped = Math.max(0, data.length - rowsReady - rowsToQuarantine);

    return {
      target: validTarget,
      targetLabel: this.getTargetLabel(validTarget),
      canImport: missingRequiredColumns.length === 0 && rowsReady + rowsToQuarantine > 0,
      headers: this.getWorksheetHeaders(data),
      mapping,
      rowsProcessed: data.length,
      rowsReady,
      rowsSkipped,
      duplicateRows,
      existingRows,
      missingPersonIdRows,
      missingNaturalKeyRows,
      missingSchoolRows,
      gradeIssueRows,
      roomIssueRows,
      differentSchoolRows,
      missingSchools,
      rowsToInsert,
      rowsToUpdate,
      rowsToQuarantine,
      mappedColumns: Object.keys(mapping),
      mappedColumnSamples: this.mappedColumnSamples(mapping, data),
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
    if (validTarget !== 'student_term' && manualSchools.length > 0) {
      throw new BadRequestException('ข้อมูลโรงเรียนเพิ่มเติมใช้ได้เฉพาะการนำเข้ารายภาคเรียน');
    }

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

    const knownSchoolIds = new Set<number>();
    let fileSchoolIds: number[] = [];
    const knownStudentStatusCodes = new Set<number>();
    const knownGradeIds = new Set<number>();
    if (validTarget === 'student_term') {
      fileSchoolIds = this.numericReferenceIds(data, mapping['SchoolID_Onec']);
      const existingSchoolIds = await this.importsRepository.findExistingSchoolIds(fileSchoolIds);
      const fileSchoolIdSet = new Set(fileSchoolIds);
      const invalidManualSchool = manualSchools.find((school) => !fileSchoolIdSet.has(school.id));
      if (invalidManualSchool) {
        throw new BadRequestException(
          `รหัสโรงเรียน ${invalidManualSchool.id} ไม่ได้อยู่ในไฟล์นำเข้า`,
        );
      }
      for (const schoolId of [...existingSchoolIds, ...manualSchools.map((school) => school.id)]) {
        knownSchoolIds.add(schoolId);
      }
      const unresolvedSchoolIds = fileSchoolIds.filter((schoolId) => !knownSchoolIds.has(schoolId));
      if (unresolvedSchoolIds.length > 0) {
        throw new BadRequestException(
          `ไม่พบโรงเรียนในข้อมูลหลัก: ${unresolvedSchoolIds.join(', ')}`,
        );
      }
      const statusCodes = this.numericReferenceIds(data, mapping['StudentStatusID_Onec']);
      const gradeIds = this.numericReferenceIds(data, mapping['GradeLevelID_Onec']);
      const [statuses, grades] = await Promise.all([
        this.importsRepository.findStudentStatusLabels(statusCodes),
        this.importsRepository.findGradeLabels(gradeIds),
      ]);
      for (const code of this.mappedStudentStatusCodes(statuses)) {
        knownStudentStatusCodes.add(code);
      }
      for (const grade of grades) knownGradeIds.add(Number(grade.id));
      const schoolDetails = await this.importsRepository.findSchoolScopeDetails(fileSchoolIds);
      this.assertActorImportScope(actor, data, mapping, schoolDetails);
    }

    this.logger.log(`Found ${data.length} rows. Mapping to ${validTarget}...`);
    const actorUserId = resolveAuditActorId(actor);
    const sourceSha256 = createHash('sha256').update(file.buffer).digest('hex');
    const mappedRows = data.map((row) => this.buildImportDbRow(mapping, row));
    const batchId = await this.importsRepository.createImportBatch({
      target: validTarget,
      sourceSha256,
      scopeSnapshot: actor?.data_scope ?? {},
      totalRows: data.length,
      actorUserId,
    });

    try {
      const result = await this.importsRepository.withTransaction(async (executor) => {
        for (const school of manualSchools) {
          await this.importsRepository.upsertManualSchool(school, executor);
        }

        let inserted = 0;
        let updated = 0;
        let skipped = 0;
        let quarantined = 0;
        const seenKeys = new Set<string>();
        const readyStudentTermRows: Record<string, unknown>[] = [];
        const resolvedPersonUuids = new Map<string, string>();
        const conflictingPersonIds = new Set<string>();
        if (validTarget === 'student_term') {
          const identifiers = [
            ...new Set(
              mappedRows
                .map((row) => this.normalizeNationalId(row['PersonID_Onec']))
                .filter(Boolean),
            ),
          ];
          const matches = await this.importsRepository.findPersonUuidMatchesByNationalIds(
            identifiers,
            executor,
          );
          const matchesByIdentifier = new Map<string, string[]>();
          for (const match of matches) {
            const current = matchesByIdentifier.get(match.identifier_normalized) ?? [];
            current.push(match.person_uuid);
            matchesByIdentifier.set(match.identifier_normalized, current);
          }
          for (const [identifier, personUuids] of matchesByIdentifier) {
            if (personUuids.length > 1) conflictingPersonIds.add(identifier);
            if (personUuids.length === 1) resolvedPersonUuids.set(identifier, personUuids[0]);
          }
        }

        const quarantine = async (
          dbRow: Record<string, unknown>,
          sourceRowNumber: number,
          reasonCode: ImportQuarantineReason,
        ): Promise<void> => {
          const schoolValue = this.normalizePositiveInteger(dbRow['SchoolID_Onec']);
          await this.importsRepository.quarantineImportRow(
            {
              batchId,
              schoolId: schoolValue ? Number(schoolValue) : null,
              sourceRowNumber,
              rowFingerprint: this.fingerprint({ target: validTarget, values: dbRow }),
              reasonCode,
              mappedValues: dbRow,
              actorUserId,
            },
            executor,
          );
          quarantined += 1;
        };

        for (const [index, dbRow] of mappedRows.entries()) {
          const sourceRowNumber = index + 2;

          const personId = dbRow['PersonID_Onec'];
          if (this.normalizeScalar(personId).length === 0) {
            await quarantine(dbRow, sourceRowNumber, 'BLANK_REQUIRED_IDENTITY');
            continue;
          }

          if (validTarget === 'student_term') {
            const rowKey = this.studentTermKey(dbRow);
            if (!rowKey) {
              await quarantine(dbRow, sourceRowNumber, 'MISSING_NATURAL_KEY_FIELD');
              continue;
            }
            if (seenKeys.has(rowKey)) {
              await quarantine(dbRow, sourceRowNumber, 'DUPLICATE_ROW_IN_FILE');
              continue;
            }
            const schoolId = Number(this.normalizePositiveInteger(dbRow['SchoolID_Onec']));
            if (!knownSchoolIds.has(schoolId)) {
              skipped++;
              continue;
            }
            seenKeys.add(rowKey);

            const normalizedPersonId = this.normalizeNationalId(personId);
            if (conflictingPersonIds.has(normalizedPersonId)) {
              await quarantine(dbRow, sourceRowNumber, 'IDENTIFIER_CONFLICT');
              continue;
            }
            const statusCode = this.normalizeScalar(dbRow['StudentStatusID_Onec']);
            if (statusCode && !knownStudentStatusCodes.has(Number(statusCode))) {
              await quarantine(dbRow, sourceRowNumber, 'UNMAPPED_STUDENT_STATUS');
              continue;
            }
            const gradeRoomIssue = this.gradeRoomIssue(dbRow, knownGradeIds);
            if (gradeRoomIssue) {
              await quarantine(dbRow, sourceRowNumber, gradeRoomIssue);
              continue;
            }
            this.applyCanonicalStudentStatus(dbRow, knownStudentStatusCodes);
          }

          const normalizedPersonId = this.normalizeNationalId(personId);
          let personUuid = resolvedPersonUuids.get(normalizedPersonId);
          if (!personUuid) {
            personUuid = await this.importsRepository.resolveOrCreatePersonByNationalId(
              this.stringifyIdentifierValue(personId),
              normalizedPersonId,
              executor,
            );
            resolvedPersonUuids.set(normalizedPersonId, personUuid);
          }
          dbRow['person_uuid'] = personUuid;

          if (validTarget === 'student_term') {
            readyStudentTermRows.push(dbRow);
            continue;
          }

          const action = await this.importsRepository.insertImportRow(validTarget, dbRow, executor);
          if (action === 'inserted') {
            inserted++;
          } else if (action === 'updated') {
            updated++;
          } else {
            skipped++;
          }
        }

        if (readyStudentTermRows.length > 0) {
          const writeSummary = await this.importsRepository.bulkUpsertStudentTerms(
            readyStudentTermRows,
            executor,
          );
          inserted += writeSummary.inserted;
          updated += writeSummary.updated;
        }

        await this.importsRepository.completeImportBatch(
          batchId,
          { importedRows: inserted + updated, quarantinedRows: quarantined },
          executor,
        );

        this.logger.log(
          `Successfully completed import into ${validTarget} (inserted: ${inserted}, updated: ${updated}, quarantined: ${quarantined}, skipped: ${skipped})`,
        );
        const result = {
          success: true,
          rowsProcessed: data.length,
          rowsInserted: inserted,
          rowsUpdated: updated,
          rowsSkipped: skipped,
          rowsQuarantined: quarantined,
        };
        await this.auditLog.recordAtomic(
          {
            actorUserId,
            actorLabel: this.actorLabel(actor),
            action: 'DATA_IMPORT',
            targetType: 'import',
            targetId: null,
            metadata: {
              target: this.getTargetLabel(validTarget),
              rowCount: result.rowsProcessed,
              rowsInserted: result.rowsInserted,
              rowsUpdated: result.rowsUpdated,
              rowsSkipped: result.rowsSkipped,
              rowsQuarantined: result.rowsQuarantined,
              manualSchools: manualSchools.length,
            },
            ip: auditMeta.ip ?? null,
          },
          executor,
        );
        return result;
      });
      if (actorUserId !== null) {
        await this.notificationsService?.notifyImportCompleted({
          batchId,
          actorUserId,
          targetLabel: this.getTargetLabel(validTarget),
          importedRows: result.rowsInserted + result.rowsUpdated,
          quarantinedRows: result.rowsQuarantined,
        });
      }
      return result;
    } catch (error) {
      try {
        await this.importsRepository.failImportBatch(batchId);
      } catch {
        this.logger.error(`Failed to persist FAILED status for ${validTarget} import batch`);
      }
      if (actorUserId !== null) {
        await this.notificationsService?.notifyImportFailed({
          batchId,
          actorUserId,
          targetLabel: this.getTargetLabel(validTarget),
        });
      }
      throw error;
    }
  }

  private quarantineValues(
    row: Record<string, unknown>,
    target?: ImportTarget,
  ): Record<string, unknown> {
    if (!row.mapped_values || typeof row.mapped_values !== 'object') return {};
    const raw = row.mapped_values as Record<string, unknown>;
    if (!target) return { ...raw };
    // Strip columns that aren't in the target's whitelist — mapped_values may
    // contain extra file columns (e.g. _demoReason) that would be rejected by
    // the SQL identifier guard in insertImportRow.
    const allowed = IMPORT_TARGET_COLUMNS[target];
    return Object.fromEntries(Object.entries(raw).filter(([key]) => allowed.has(key)));
  }

  private async validateQuarantineValuesForImport(
    importTarget: ImportTarget,
    values: Record<string, unknown>,
    executor: QueryExecutor,
  ): Promise<void> {
    if (importTarget !== 'student_term') return;

    if (this.normalizeNationalId(values['PersonID_Onec']).length === 0) {
      throw new BadRequestException('รายการนี้ยังไม่มีรหัสประจำตัวที่นำเข้าได้');
    }
    if (!this.studentTermKey(values)) {
      throw new BadRequestException('ปีการศึกษา เทอม หรือโรงเรียนยังไม่ครบ');
    }

    const schoolId = Number(this.normalizePositiveInteger(values['SchoolID_Onec']));
    if (!schoolId) throw new BadRequestException('รหัสโรงเรียนยังไม่ถูกต้อง');
    const existingSchoolIds = await this.importsRepository.findExistingSchoolIds(
      [schoolId],
      executor,
    );
    if (!existingSchoolIds.includes(schoolId)) {
      throw new BadRequestException('ยังไม่พบโรงเรียนในข้อมูลหลัก');
    }

    const statusCode = this.normalizePositiveInteger(values['StudentStatusID_Onec']);
    if (statusCode) {
      const statuses = await this.importsRepository.findStudentStatusLabels(
        [Number(statusCode)],
        executor,
      );
      const knownStudentStatusCodes = this.mappedStudentStatusCodes(statuses);
      if (!knownStudentStatusCodes.has(Number(statusCode))) {
        throw new BadRequestException('สถานะนักเรียนยังไม่ได้จับคู่');
      }
      this.applyCanonicalStudentStatus(values, knownStudentStatusCodes);
    }

    const gradeId = this.normalizePositiveInteger(values['GradeLevelID_Onec']);
    const grades = gradeId
      ? await this.importsRepository.findGradeLabels([Number(gradeId)], executor)
      : [];
    const knownGradeIds = new Set(grades.map((grade) => Number(grade.id)));
    const gradeRoomIssue = this.gradeRoomIssue(values, knownGradeIds);
    if (gradeRoomIssue === 'GRADE_NOT_FOUND') {
      throw new BadRequestException('ยังไม่พบชั้นเรียนในข้อมูลหลัก');
    }
    if (gradeRoomIssue === 'ROOM_NOT_FOUND') {
      throw new BadRequestException('รหัสห้องยังไม่ถูกต้อง');
    }
  }

  private async resolveQuarantinePersonUuid(
    id: string,
    reasonCode: string,
    values: Record<string, unknown>,
    input: ResolveImportQuarantineDto,
    actor: AuthenticatedRequestUser,
    executor: QueryExecutor,
  ): Promise<string> {
    const personId = this.normalizeNationalId(values['PersonID_Onec']);
    if (personId.length === 0) {
      throw new BadRequestException('รายการนี้ยังไม่มีรหัสประจำตัวที่นำเข้าได้');
    }

    if (reasonCode === 'IDENTIFIER_CONFLICT') {
      if (!input.candidateKey) {
        throw new BadRequestException('candidateKey is required for RESOLVE');
      }
      const candidates = await this.importsRepository.findPersonUuidsByNationalId(
        personId,
        actor.data_scope ?? {},
        executor,
        50,
      );
      const selectedPersonUuid = candidates.find(
        (personUuid) => this.quarantineCandidateKey(id, personUuid) === input.candidateKey,
      );
      if (!selectedPersonUuid) {
        throw new BadRequestException('บุคคลที่เลือกไม่ตรงกับรหัสประจำตัวในรายการ');
      }
      return selectedPersonUuid;
    }

    if (!RETRYABLE_QUARANTINE_REASONS.has(reasonCode)) {
      throw new BadRequestException('รายการนี้ต้องแก้ข้อมูลต้นทางแล้วนำเข้าใหม่');
    }

    const matches = await this.importsRepository.findPersonUuidMatchesByNationalIds(
      [personId],
      executor,
    );
    const personUuids = [...new Set(matches.map((match) => match.person_uuid))];
    if (personUuids.length > 1) {
      throw new BadRequestException('พบหลายบุคคลสำหรับรหัสนี้ กรุณาใช้การผูกบุคคลเดิม');
    }
    if (personUuids.length === 1) return personUuids[0];
    return await this.importsRepository.createPersonForNationalId(
      this.stringifyIdentifierValue(values['PersonID_Onec']),
      personId,
      executor,
    );
  }

  async listQuarantine(query: ListImportQuarantineDto, actor: AuthenticatedRequestUser) {
    if (actor.data_scope?.own_only) {
      throw new ForbiddenException('บัญชีนี้ไม่มีสิทธิ์จัดการรายการนำเข้าที่รอตรวจสอบ');
    }
    const [result, lookups] = await Promise.all([
      this.importsRepository.listQuarantine(
        {
          page: query.page,
          limit: query.limit,
          status: query.status,
          reasonCode: query.reasonCode,
          search: query.search,
          province: query.province,
          district: query.district,
          subDistrict: query.subDistrict,
          schoolId: query.schoolId,
        },
        actor.data_scope ?? {},
      ),
      this.quarantineLookupContext(),
    ]);
    return {
      items: result.rows.map((row) => this.toQuarantineItem(row, lookups)),
      meta: { page: query.page, limit: query.limit, totalCount: result.totalCount },
    };
  }

  async getQuarantineLookups() {
    const lookups = await this.quarantineLookupContext();
    const toOptions = (map: Map<string, QuarantineLookupMeta>) =>
      [...map.entries()].map(([code, meta]) => ({
        code,
        label: meta.label,
        ...(meta.variant ? { variant: meta.variant } : {}),
      }));
    return {
      reasons: toOptions(lookups.reason),
      resolutionStates: toOptions(lookups.resolution),
      statuses: toOptions(lookups.status),
    };
  }

  async getQuarantine(id: string, actor: AuthenticatedRequestUser) {
    if (!/^\d+$/.test(id)) throw new BadRequestException('Invalid quarantine row id');
    if (actor.data_scope?.own_only) {
      throw new ForbiddenException('บัญชีนี้ไม่มีสิทธิ์จัดการรายการนำเข้าที่รอตรวจสอบ');
    }
    return this.importsRepository.withTransaction(async (executor) => {
      const row = await this.importsRepository.findQuarantine(id, actor.data_scope ?? {}, executor);
      if (!row) throw new NotFoundException('ไม่พบรายการนำเข้าที่รอตรวจสอบ');
      const lookups = await this.quarantineLookupContext(executor);
      return this.toQuarantineItem(row, lookups);
    });
  }

  private toQuarantineItem(row: Record<string, unknown>, lookups: QuarantineLookupContext) {
    const values =
      row.mapped_values && typeof row.mapped_values === 'object'
        ? (row.mapped_values as Record<string, unknown>)
        : {};
    const reasonCode = String(row.reason_code);
    const statusCode = String(row.status);
    const reasonLabel =
      this.normalizeScalar(row.reason_label) ||
      this.quarantineLookup(lookups.reason, reasonCode).label;
    const statusMeta = this.quarantineLookup(lookups.status, statusCode, 'secondary');
    const resolution = this.quarantineResolution({ ...row, reason_label: reasonLabel }, lookups);
    const editableValues = Object.fromEntries(
      resolution.editableFields.map((field) => [field, this.normalizeScalar(values[field])]),
    );
    return {
      id: String(row.id),
      schoolId: row.school_id == null ? null : Number(row.school_id),
      schoolName: typeof row.school_name === 'string' ? row.school_name : null,
      schoolDistrict: typeof row.school_district === 'string' ? row.school_district : null,
      schoolSubDistrict:
        typeof row.school_sub_district === 'string' ? row.school_sub_district : null,
      sourceRowNumber: Number(row.source_row_number),
      reasonCode,
      reasonLabel,
      status: statusCode,
      statusLabel: this.normalizeScalar(row.status_label) || statusMeta.label,
      statusBadgeVariant:
        (this.normalizeScalar(row.status_badge_variant) as QuarantineBadgeVariant) ||
        statusMeta.variant ||
        'secondary',
      target: String(row.target),
      student: {
        personIdMasked: this.maskIdentifier(values['PersonID_Onec']),
        firstName: this.normalizeScalar(values['FirstName_Onec']) || '-',
        lastName: this.normalizeScalar(values['LastName_Onec']) || '-',
        academicYear: this.normalizeScalar(values['AcademicYear_Onec']) || '-',
        semester: this.normalizeScalar(values['Semester_Onec']) || '-',
        province: typeof row.school_province === 'string' ? row.school_province : null,
        gradeLevelId: this.normalizeScalar(values['GradeLevelID_Onec']) || null,
        gradeLabel: typeof row.source_grade_label === 'string' ? row.source_grade_label : null,
        roomId: this.normalizeScalar(values['RoomID_Onec']) || null,
        studentStatusCode: this.normalizeScalar(values['StudentStatusID_Onec']) || null,
        studentStatusLabel: this.importStatusLabel({
          label: typeof row.source_status_label === 'string' ? row.source_status_label : null,
          category:
            typeof row.source_status_category === 'string' ? row.source_status_category : null,
        }),
      },
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      resolutionNote: typeof row.resolution_note === 'string' ? row.resolution_note : null,
      resolvedByName: typeof row.resolved_by_name === 'string' ? row.resolved_by_name : null,
      changedFieldLabels: Array.isArray(row.changed_fields)
        ? row.changed_fields.map(
            (field) => QUARANTINE_FIELD_LABELS_TH[String(field)] ?? String(field),
          )
        : [],
      changedFieldDetails: this.toChangedFieldDetails(row.changed_field_details),
      resolution,
      editableValues,
    };
  }

  /**
   * Readable context for quarantine audit entries so the history list/detail
   * can show who was affected without joining back to the row. Student names
   * are scope-gated data, not secrets; identifiers stay masked elsewhere.
   */
  private quarantineAuditContext(row: Record<string, unknown>, lookups?: QuarantineLookupContext) {
    const values =
      row.mapped_values && typeof row.mapped_values === 'object'
        ? (row.mapped_values as Record<string, unknown>)
        : {};
    const reasonCode = String(row.reason_code);
    const studentName = [
      this.normalizeScalar(values['FirstName_Onec']),
      this.normalizeScalar(values['LastName_Onec']),
    ]
      .filter(Boolean)
      .join(' ');
    return {
      studentName: studentName || '-',
      reasonLabel:
        this.normalizeScalar(row.reason_label) ||
        (lookups ? this.quarantineLookup(lookups.reason, reasonCode).label : reasonCode),
      schoolName: typeof row.school_name === 'string' ? row.school_name : undefined,
      sourceRowNumber:
        row.source_row_number === null || row.source_row_number === undefined
          ? undefined
          : Number(row.source_row_number),
      academicYear: this.normalizeScalar(values['AcademicYear_Onec']) || undefined,
      semester: this.normalizeScalar(values['Semester_Onec']) || undefined,
      gradeRoom:
        [
          typeof row.source_grade_label === 'string'
            ? row.source_grade_label
            : this.normalizeScalar(values['GradeLevelID_Onec']),
          this.normalizeScalar(values['RoomID_Onec']),
        ]
          .filter(Boolean)
          .join(' / ') || undefined,
      studentStatus:
        this.importStatusLabel({
          label: typeof row.source_status_label === 'string' ? row.source_status_label : null,
          category:
            typeof row.source_status_category === 'string' ? row.source_status_category : null,
        }) ||
        this.normalizeScalar(values['StudentStatusID_Onec']) ||
        undefined,
    };
  }

  private quarantineRetryFilters(query: RetryImportQuarantineDto) {
    return {
      reasonCode: query.reasonCode,
      search: query.search,
      province: query.province,
      district: query.district,
      subDistrict: query.subDistrict,
      schoolId: query.schoolId,
    };
  }

  private quarantineResolution(row: Record<string, unknown>, lookups: QuarantineLookupContext) {
    const withResolutionMeta = <T extends { state: string }>(resolution: T) => {
      const meta = this.quarantineLookup(lookups.resolution, resolution.state, 'secondary');
      return {
        ...resolution,
        label: meta.label,
        variant: meta.variant ?? 'secondary',
      };
    };
    if (String(row.status) !== 'PENDING') {
      return withResolutionMeta({
        state: 'BLOCKED' as const,
        action: 'NONE' as const,
        code: 'ALREADY_PROCESSED',
        message: 'รายการนี้ถูกดำเนินการแล้ว',
        editableFields: [] as string[],
      });
    }
    const reasonCode = String(row.reason_code);
    if (reasonCode === 'IDENTIFIER_CONFLICT') {
      return withResolutionMeta({
        state: 'DECISION_REQUIRED' as const,
        action: 'SELECT_CANDIDATE' as const,
        code: reasonCode,
        message: 'ต้องเลือกโปรไฟล์ที่ตรงกับนักเรียนก่อนนำเข้า',
        editableFields: [] as string[],
      });
    }
    if (row.retry_eligible === true) {
      return withResolutionMeta({
        state: 'RETRY_ELIGIBLE' as const,
        action: 'RETRY' as const,
        code: reasonCode,
        message: 'ผ่านการตรวจเบื้องต้น สามารถลองนำเข้าได้',
        editableFields: [] as string[],
      });
    }
    const configuredEditableFields = [...(QUARANTINE_EDITABLE_FIELDS[reasonCode] ?? [])];
    const missingKeyFields =
      reasonCode === 'MISSING_NATURAL_KEY_FIELD'
        ? this.missingStudentTermKeyFields(
            row.mapped_values && typeof row.mapped_values === 'object'
              ? (row.mapped_values as Record<string, unknown>)
              : {},
          )
        : [];
    const editableFields =
      reasonCode === 'MISSING_NATURAL_KEY_FIELD' && missingKeyFields.length > 0
        ? missingKeyFields
        : configuredEditableFields;
    if (editableFields.length > 0) {
      return withResolutionMeta({
        state: 'ACTION_REQUIRED' as const,
        action: 'EDIT_FIELDS' as const,
        code: reasonCode,
        message:
          this.normalizeScalar(row.reason_label) ||
          this.quarantineLookup(lookups.reason, reasonCode).label,
        editableFields,
      });
    }
    return withResolutionMeta({
      state: 'BLOCKED' as const,
      action: 'OPEN_REVIEW' as const,
      code: reasonCode,
      message: 'กรณีนี้ต้องตรวจสอบใน workflow ที่เกี่ยวข้อง',
      editableFields: [] as string[],
    });
  }

  async retryableQuarantineSummary(
    query: RetryImportQuarantineDto,
    actor: AuthenticatedRequestUser,
  ) {
    if (actor.data_scope?.own_only) {
      throw new ForbiddenException('บัญชีนี้ไม่มีสิทธิ์จัดการรายการนำเข้าที่รอตรวจสอบ');
    }
    const readyCount = await this.importsRepository.countReadyQuarantineRows(
      this.quarantineRetryFilters(query),
      actor.data_scope ?? {},
    );
    return { readyCount, batchLimit: QUARANTINE_RETRY_BATCH_LIMIT };
  }

  async retryReadyQuarantine(query: RetryImportQuarantineDto, actor: AuthenticatedRequestUser) {
    if (actor.data_scope?.own_only) {
      throw new ForbiddenException('บัญชีนี้ไม่มีสิทธิ์จัดการรายการนำเข้าที่รอตรวจสอบ');
    }
    const filters = this.quarantineRetryFilters(query);
    const rows = await this.importsRepository.findReadyQuarantineRows(
      filters,
      actor.data_scope ?? {},
      QUARANTINE_RETRY_BATCH_LIMIT,
    );
    let processedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    const items: Array<{
      id: string;
      sourceRowNumber: number;
      studentName: string;
      outcome: string;
      code: string;
      message: string;
    }> = [];

    for (const { id, sourceRowNumber, studentName } of rows) {
      try {
        await this.resolveQuarantine(id, { action: 'RESOLVE' }, actor);
        processedCount += 1;
        items.push({
          id,
          sourceRowNumber,
          studentName,
          outcome: 'IMPORTED',
          code: 'IMPORTED',
          message: 'นำเข้าสำเร็จ',
        });
      } catch (error) {
        if (
          error instanceof BadRequestException ||
          error instanceof ConflictException ||
          error instanceof NotFoundException
        ) {
          skippedCount += 1;
          items.push({
            id,
            sourceRowNumber,
            studentName,
            outcome: 'NEEDS_ACTION',
            code: error instanceof ConflictException ? 'ALREADY_PROCESSED' : 'VALIDATION_FAILED',
            message: error.message,
          });
          continue;
        }
        failedCount += 1;
        this.logger.error(`Bulk quarantine retry failed for row ${id}`);
        items.push({
          id,
          sourceRowNumber,
          studentName,
          outcome: 'FAILED',
          code: 'IMPORT_FAILED',
          message: 'นำเข้าไม่สำเร็จ กรุณาตรวจสอบรายการนี้อีกครั้ง',
        });
      }
    }

    const remainingReadyCount = await this.importsRepository.countReadyQuarantineRows(
      filters,
      actor.data_scope ?? {},
    );
    this.logger.log(
      `Completed quarantine retry batch (selected: ${rows.length}, processed: ${processedCount}, skipped: ${skippedCount}, failed: ${failedCount}, remaining: ${remainingReadyCount})`,
    );
    return {
      selectedCount: rows.length,
      processedCount,
      skippedCount,
      failedCount,
      remainingReadyCount,
      batchLimit: QUARANTINE_RETRY_BATCH_LIMIT,
      items,
    };
  }

  async fixQuarantineValues(
    id: string,
    input: FixImportQuarantineDto,
    actor: AuthenticatedRequestUser,
  ) {
    if (!/^\d+$/.test(id)) throw new BadRequestException('Invalid quarantine row id');
    if (actor.data_scope?.own_only) {
      throw new ForbiddenException('บัญชีนี้ไม่มีสิทธิ์จัดการรายการนำเข้าที่รอตรวจสอบ');
    }
    return this.importsRepository.withTransaction(async (executor) => {
      const row = await this.importsRepository.findQuarantineForUpdate(
        id,
        actor.data_scope ?? {},
        executor,
      );
      if (!row) throw new NotFoundException('ไม่พบรายการนำเข้าที่รอตรวจสอบ');
      if (row.status !== 'PENDING') throw new ConflictException('รายการนี้ถูกดำเนินการแล้ว');
      const lookups = await this.quarantineLookupContext(executor);
      const reasonCode = String(row.reason_code);
      const allowedFields = new Set(QUARANTINE_EDITABLE_FIELDS[reasonCode] ?? []);
      const submittedValues = Object.fromEntries(
        Object.entries(input.values ?? {}).filter(([, value]) => value !== undefined),
      );
      const submittedFields = Object.keys(submittedValues);
      if (
        submittedFields.length === 0 ||
        submittedFields.some((field) => !allowedFields.has(field))
      ) {
        throw new BadRequestException('ฟิลด์ที่ส่งมาไม่ตรงกับวิธีแก้ของรายการนี้');
      }
      const importTarget = String(row.target);
      if (!isImportTarget(importTarget) || importTarget !== 'student_term') {
        throw new BadRequestException('รายการนี้ยังไม่รองรับการแก้ข้อมูลจากหน้านี้');
      }
      const originalValues = this.quarantineValues(row, importTarget);
      const values: Record<string, unknown> = { ...originalValues, ...submittedValues };
      const schoolId = Number(this.normalizePositiveInteger(values['SchoolID_Onec']));
      const schoolDetails = schoolId
        ? await this.importsRepository.findSchoolScopeDetails([schoolId])
        : [];
      this.assertActorImportScope(
        actor,
        [values],
        {
          SchoolID_Onec: 'SchoolID_Onec',
          GradeLevelID_Onec: 'GradeLevelID_Onec',
          RoomID_Onec: 'RoomID_Onec',
        },
        schoolDetails,
      );
      await this.validateQuarantineValuesForImport(importTarget, values, executor);
      const personUuid = await this.resolveQuarantinePersonUuid(
        id,
        reasonCode,
        values,
        { action: 'RESOLVE' },
        actor,
        executor,
      );
      // person_uuid is only an insert column; keep it out of mapped_values —
      // resolved_person_uuid already records the linkage.
      const correctedMappedValues = { ...values };
      values['person_uuid'] = personUuid;
      await this.importsRepository.insertImportRow(importTarget, values, executor);
      await this.importsRepository.updateQuarantineMappedValues(
        id,
        correctedMappedValues,
        schoolId,
        actor.id,
        executor,
      );
      await this.importsRepository.resolveQuarantineRow(
        id,
        { status: 'RESOLVED', personUuid, actorId: actor.id },
        executor,
      );
      const changedFields = submittedFields.filter(
        (field) =>
          this.normalizeScalar(originalValues[field]) !== this.normalizeScalar(values[field]),
      );
      const changedFieldDetails = this.quarantineChangedFieldDetails(
        changedFields,
        originalValues,
        values,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actor.id,
          actorLabel: this.actorLabel(actor),
          action: 'IMPORT_QUARANTINE_RESOLVED',
          targetType: 'student_import_quarantine_row',
          targetId: id,
          metadata: {
            status: 'RESOLVED',
            statusLabel: this.quarantineLookup(lookups.status, 'RESOLVED').label,
            reasonCode,
            changedFields,
            changedFieldDetails,
            changedFieldLabels: changedFields
              .map((field) => QUARANTINE_FIELD_LABELS_TH[field] ?? field)
              .join(', '),
            ...this.quarantineAuditContext(row, lookups),
          },
        },
        executor,
      );
      return { id, status: 'RESOLVED' as const, changedFields };
    });
  }

  async resolveQuarantine(
    id: string,
    input: ResolveImportQuarantineDto,
    actor: AuthenticatedRequestUser,
  ) {
    if (!/^\d+$/.test(id)) throw new BadRequestException('Invalid quarantine row id');
    if (actor.data_scope?.own_only) {
      throw new ForbiddenException('บัญชีนี้ไม่มีสิทธิ์จัดการรายการนำเข้าที่รอตรวจสอบ');
    }

    const result = await this.importsRepository.withTransaction(async (executor) => {
      const row = await this.importsRepository.findQuarantineForUpdate(
        id,
        actor.data_scope ?? {},
        executor,
      );
      if (!row) throw new NotFoundException('ไม่พบรายการนำเข้าที่รอตรวจสอบ');
      if (row.status !== 'PENDING') throw new ConflictException('รายการนี้ถูกดำเนินการแล้ว');
      const lookups = await this.quarantineLookupContext(executor);

      if (input.action === 'REJECT') {
        const rejectionNote = input.note?.trim();
        if (!rejectionNote) throw new BadRequestException('กรุณาระบุเหตุผลที่ปฏิเสธ');
        await this.importsRepository.resolveQuarantineRow(
          id,
          { status: 'REJECTED', note: rejectionNote, actorId: actor.id },
          executor,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId: actor.id,
            actorLabel: this.actorLabel(actor),
            action: 'IMPORT_QUARANTINE_REJECTED',
            targetType: 'student_import_quarantine_row',
            targetId: id,
            metadata: {
              status: 'REJECTED',
              statusLabel: this.quarantineLookup(lookups.status, 'REJECTED').label,
              note: rejectionNote,
              ...this.quarantineAuditContext(row, lookups),
            },
          },
          executor,
        );
        return { id, status: 'REJECTED' as const };
      }

      const importTarget = String(row.target);
      if (!isImportTarget(importTarget)) throw new BadRequestException('Invalid import target');
      const values = this.quarantineValues(row, importTarget);
      await this.validateQuarantineValuesForImport(importTarget, values, executor);
      const selectedPersonUuid = await this.resolveQuarantinePersonUuid(
        id,
        String(row.reason_code),
        values,
        input,
        actor,
        executor,
      );
      values['person_uuid'] = selectedPersonUuid;
      await this.importsRepository.insertImportRow(importTarget, values, executor);
      await this.importsRepository.resolveQuarantineRow(
        id,
        {
          status: 'RESOLVED',
          personUuid: selectedPersonUuid,
          note: input.note,
          actorId: actor.id,
        },
        executor,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actor.id,
          actorLabel: this.actorLabel(actor),
          action: 'IMPORT_QUARANTINE_RESOLVED',
          targetType: 'student_import_quarantine_row',
          targetId: id,
          metadata: {
            status: 'RESOLVED',
            statusLabel: this.quarantineLookup(lookups.status, 'RESOLVED').label,
            ...this.quarantineAuditContext(row, lookups),
          },
        },
        executor,
      );
      return { id, status: 'RESOLVED' as const };
    });
    return result;
  }

  async listQuarantineCandidates(id: string, actor: AuthenticatedRequestUser) {
    if (!/^\d+$/.test(id)) throw new BadRequestException('Invalid quarantine row id');
    if (actor.data_scope?.own_only) {
      throw new ForbiddenException('บัญชีนี้ไม่มีสิทธิ์จัดการรายการนำเข้าที่รอตรวจสอบ');
    }
    return this.importsRepository.withTransaction(async (executor) => {
      const row = await this.importsRepository.findQuarantine(id, actor.data_scope ?? {}, executor);
      if (!row) throw new NotFoundException('ไม่พบรายการนำเข้าที่รอตรวจสอบ');
      if (row.status !== 'PENDING' || row.reason_code !== 'IDENTIFIER_CONFLICT') {
        return { items: [], meta: { totalCount: 0, visibleCount: 0 }, importRow: null };
      }
      const values =
        row.mapped_values && typeof row.mapped_values === 'object'
          ? (row.mapped_values as Record<string, unknown>)
          : {};
      const personId = this.normalizeNationalId(values['PersonID_Onec']);
      const candidates = await this.importsRepository.findPersonCandidateDetailsByNationalId(
        personId,
        actor.data_scope ?? {},
        executor,
      );
      const totalCount = await this.importsRepository.countPersonCandidatesByNationalId(
        personId,
        executor,
      );
      const importGradeId = this.normalizePositiveInteger(values['GradeLevelID_Onec']);
      const importStatusCode = this.normalizePositiveInteger(values['StudentStatusID_Onec']);
      return {
        items: candidates.map((candidate) => ({
          candidateKey: this.quarantineCandidateKey(id, candidate.person_uuid),
          firstName: candidate.first_name ?? '-',
          lastName: candidate.last_name ?? '-',
          personIdMasked: this.maskIdentifier(values['PersonID_Onec']),
          schoolName: candidate.school_name,
          province: candidate.school_province,
          gradeLevelId: candidate.grade_level_id,
          gradeLevelLabel: candidate.grade_level_label,
          roomId: candidate.room_id,
          academicYear: candidate.academic_year,
          semester: candidate.semester,
          studentStatusCode: candidate.student_status_code,
          studentStatusLabel: candidate.student_status_label,
        })),
        meta: { totalCount, visibleCount: candidates.length },
        importRow: {
          firstName: this.normalizeScalar(values['FirstName_Onec']) || '-',
          lastName: this.normalizeScalar(values['LastName_Onec']) || '-',
          personIdMasked: this.maskIdentifier(values['PersonID_Onec']),
          schoolName:
            typeof row.school_name === 'string'
              ? row.school_name
              : this.normalizeScalar(values['SchoolID_Onec']) || '-',
          province: typeof row.school_province === 'string' ? row.school_province : null,
          gradeLevelId: importGradeId ? Number(importGradeId) : null,
          gradeLevelLabel:
            typeof row.source_grade_label === 'string' ? row.source_grade_label : null,
          roomId: this.normalizeScalar(values['RoomID_Onec']) || null,
          academicYear: this.normalizeScalar(values['AcademicYear_Onec']) || null,
          semester: this.normalizeScalar(values['Semester_Onec']) || null,
          studentStatusCode: importStatusCode ? Number(importStatusCode) : null,
          studentStatusLabel:
            typeof row.source_status_label === 'string' ? row.source_status_label : null,
        },
      };
    });
  }

  async exportQuarantine(
    query: ExportImportQuarantineDto,
    actor: AuthenticatedRequestUser,
  ): Promise<string> {
    const status = query.status;
    if (actor.data_scope?.own_only) {
      throw new ForbiddenException('บัญชีนี้ไม่มีสิทธิ์ส่งออกรายการนำเข้าที่รอตรวจสอบ');
    }
    const [result, lookups] = await Promise.all([
      this.importsRepository.listQuarantine(
        {
          page: 1,
          limit: 10_000,
          status,
          reasonCode: query.reasonCode,
          search: query.search,
          province: query.province,
          district: query.district,
          subDistrict: query.subDistrict,
          schoolId: query.schoolId,
        },
        actor.data_scope ?? {},
      ),
      this.quarantineLookupContext(),
    ]);
    const rows = [
      [
        'แถวในไฟล์',
        'วันที่นำเข้า',
        'รหัสชุดนำเข้า',
        'ชื่อ',
        'นามสกุล',
        'รหัสประจำตัว (ปิดบัง)',
        'รหัสโรงเรียน',
        'โรงเรียน',
        'ปีการศึกษา',
        'เทอม',
        'สาเหตุ',
        'สถานะ',
      ],
      ...result.rows.map((row) => {
        const values =
          row.mapped_values && typeof row.mapped_values === 'object'
            ? (row.mapped_values as Record<string, unknown>)
            : {};
        const reasonCode = this.normalizeScalar(row.reason_code);
        const rowStatus = this.normalizeScalar(row.status);
        return [
          row.source_row_number,
          row.batch_created_at instanceof Date
            ? row.batch_created_at.toISOString()
            : this.normalizeScalar(row.batch_created_at),
          row.batch_id,
          this.normalizeScalar(values['FirstName_Onec']) || '-',
          this.normalizeScalar(values['LastName_Onec']) || '-',
          this.maskIdentifier(values['PersonID_Onec']),
          row.school_id,
          row.school_name,
          this.normalizeScalar(values['AcademicYear_Onec']) || '-',
          this.normalizeScalar(values['Semester_Onec']) || '-',
          this.normalizeScalar(row.reason_label) ||
            this.quarantineLookup(lookups.reason, reasonCode).label,
          this.normalizeScalar(row.status_label) ||
            this.quarantineLookup(lookups.status, rowStatus).label,
        ];
      }),
    ];
    await this.auditLog.record({
      actorUserId: actor.id,
      actorLabel: this.actorLabel(actor),
      action: 'IMPORT_QUARANTINE_EXPORT',
      targetType: 'student_import_quarantine_row',
      targetId: null,
      metadata: {
        status,
        statusLabel: this.quarantineLookup(lookups.status, status).label,
        rowCount: result.rows.length,
        truncated: result.totalCount > 10_000,
        reasonLabel: query.reasonCode
          ? this.quarantineLookup(lookups.reason, query.reasonCode).label
          : undefined,
        search: query.search?.trim() || undefined,
        province: query.province?.trim() || undefined,
        district: query.district?.trim() || undefined,
        subDistrict: query.subDistrict?.trim() || undefined,
        schoolId: query.schoolId,
      },
    });
    return `\uFEFF${rows.map((row) => row.map((value) => this.csvCell(value)).join(',')).join('\n')}`;
  }

  /**
   * Purge resolved/rejected quarantine rows older than the retention window.
   * `now` is injectable for tests. PENDING rows and the audit_log are untouched.
   */
  async cleanupExpiredQuarantine(now = new Date()): Promise<{ deleted: number }> {
    const cutoff = new Date(now.getTime() - QUARANTINE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleted = await this.importsRepository.deleteResolvedQuarantineOlderThan(cutoff);
    if (deleted > 0) {
      this.logger.log(
        `Deleted ${deleted} resolved/rejected quarantine row(s) older than ${QUARANTINE_RETENTION_DAYS} days.`,
      );
    }
    return { deleted };
  }

  @Cron(QUARANTINE_RETENTION_CRON, {
    timeZone: BANGKOK_TIME_ZONE,
    name: 'student_import_quarantine_retention_cleanup',
  })
  async runQuarantineRetentionCleanup(): Promise<void> {
    try {
      await this.cleanupExpiredQuarantine();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Quarantine retention cleanup failed: ${message}`);
    }
  }
}
