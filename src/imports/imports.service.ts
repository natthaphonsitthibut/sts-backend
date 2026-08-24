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
import { hasPermission, type AuthenticatedRequestUser } from '../auth';
import { isUnconfiguredDataScope } from '../auth/auth.types';
import { BANGKOK_TIME_ZONE } from '../common/utils/date.util';
import { normalizeScalar } from '../common/utils/helpers';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { maskPiiValue } from '../students/pii-fields.config';
import { isXlsxBuffer, looksLikeTextBuffer } from '../common/file-upload/file-signature.util';
import { ImportsRepository, type QuarantineLookupRow } from './imports.repository';
import {
  getImportCatalog,
  getImportTargetDefinition,
  isImportCatalogTarget,
  type ImportCatalogTarget,
} from './import-catalog';
import type {
  ExportImportQuarantineDto,
  FixImportQuarantineDto,
  ListImportQuarantineDto,
  ResolveImportQuarantineDto,
  RetryImportQuarantineDto,
  SchoolRosterImportContext,
} from './dto/imports.dto';
import {
  DERIVED_IMPORT_COLUMNS,
  IMPORT_TARGET_COLUMNS,
  isImportTarget,
  type ImportQuarantineReason,
  type ImportReferenceRow,
  type ImportTarget,
  type QueryExecutor,
  type SchoolRosterImportContextRow,
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
  student_term: 'ข้อมูลนักเรียนในระบบ (รายภาคเรียน)',
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
  student_term: ['PersonID_Onec', 'AcademicYear_Onec', 'Semester_Onec', 'SchoolID_Onec'],
};

const RECOMMENDED_IMPORT_COLUMNS: Record<ImportTarget, readonly string[]> = {
  student_term: [
    'student_number',
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

interface TeacherImportRow {
  rowNumber: number;
  citizenId: string;
  startedOn: string | null;
}

export interface TeacherImportPreviewResult {
  target: 'school_teacher_membership';
  rowsProcessed: number;
  rowsReady: number;
  rowsSkipped: number;
  rowsToQuarantine: number;
  sampleRows: Array<{
    rowNumber: number;
    citizenId: string;
    displayName: string;
    action: 'insert' | 'skip' | 'quarantine';
    issue: string | null;
  }>;
}

interface CatalogImportContext extends SchoolRosterImportContext {
  schoolId?: number;
}

interface StructureImportRow {
  rowNumber: number;
  values: Record<string, string>;
}

interface StructureRowEvaluation {
  row: StructureImportRow;
  action: 'insert' | 'skip' | 'quarantine';
  reason: ImportQuarantineReason | null;
  issue: string | null;
  resolved?: {
    teacherMembershipId?: string;
    gradeLevelId?: number;
    subjectId?: number | null;
    assignmentKind?: 'HOMEROOM' | 'SUBJECT';
  };
}

export interface CatalogStructureImportPreviewResult {
  target: 'school_classroom' | 'classroom_teacher_assignment';
  targetLabel: string;
  canImport: boolean;
  headers: string[];
  mapping: Record<string, string>;
  rowsProcessed: number;
  rowsReady: number;
  rowsSkipped: number;
  rowsToInsert: number;
  rowsToQuarantine: number;
  missingRequiredColumns: string[];
  unmappedHeaders: string[];
  sampleRows: Array<{
    rowNumber: number;
    action: 'insert' | 'skip' | 'quarantine';
    values: Record<string, string>;
    issues: string[];
  }>;
}

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);

  constructor(
    private readonly importsRepository: ImportsRepository,
    private readonly auditLog: AuditLogService,
  ) {}

  getCatalog(actor: AuthenticatedRequestUser) {
    return getImportCatalog(actor);
  }

  private assertCatalogCapability(
    target: ImportCatalogTarget,
    actor: AuthenticatedRequestUser,
  ): void {
    const definition = getImportTargetDefinition(target);
    if (!definition || !hasPermission(actor.roles, actor.permissions, definition.capability)) {
      throw new ForbiddenException('ไม่มีสิทธิ์นำเข้าข้อมูลประเภทนี้');
    }
  }

  private requirePositiveContextId(
    context: CatalogImportContext | undefined,
    key: keyof CatalogImportContext,
  ): number {
    const value = context?.[key];
    if (!Number.isInteger(value) || Number(value) <= 0) {
      throw new BadRequestException(`กรุณาระบุ ${String(key)} จากบริบทข้อมูลหลัก`);
    }
    return Number(value);
  }

  private stringifyIdentifierValue(value: unknown): string {
    if (typeof value === 'string' || typeof value === 'number') {
      return String(value);
    }

    return '';
  }

  private normalizeNationalId(value: unknown): string {
    return normalizeScalar(value).replace(/[^0-9]/g, '');
  }

  private normalizePositiveInteger(value: unknown): string {
    const normalized = normalizeScalar(value);
    if (!/^\d+$/.test(normalized)) {
      return '';
    }
    const numericValue = Number(normalized);
    return Number.isSafeInteger(numericValue) && numericValue > 0 ? String(numericValue) : '';
  }

  private maskIdentifier(value: unknown): string {
    const normalized = this.normalizeNationalId(value);
    return normalized ? maskPiiValue(normalized) : '-';
  }

  private maskDocumentIdentifier(value: unknown): string {
    const normalized = normalizeScalar(value);
    return normalized ? maskPiiValue(normalized) : '-';
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
    knownClassroomKeys?: ReadonlySet<string>,
  ): ImportQuarantineReason | null {
    const gradeValue = normalizeScalar(row['GradeLevelID_Onec']);
    if (gradeValue) {
      const gradeId = this.normalizePositiveInteger(gradeValue);
      if (!gradeId || !knownGradeIds.has(Number(gradeId))) return 'GRADE_NOT_FOUND';
    }

    const roomValue = normalizeScalar(row['RoomID_Onec']);
    if (roomValue && !this.normalizePositiveInteger(roomValue)) return 'ROOM_NOT_FOUND';
    if (knownClassroomKeys) {
      const classroomKey = this.classroomReferenceKey(row);
      if (!classroomKey || !knownClassroomKeys.has(classroomKey)) return 'ROOM_NOT_FOUND';
    }
    return null;
  }

  private classroomReferenceKey(row: Record<string, unknown>): string | null {
    const values = [
      row['SchoolID_Onec'],
      row['AcademicYear_Onec'],
      row['Semester_Onec'],
      row['GradeLevelID_Onec'],
      row['RoomID_Onec'],
    ].map((value) => Number(this.normalizePositiveInteger(value)));
    return values.every((value) => Number.isInteger(value) && value > 0)
      ? JSON.stringify(values)
      : null;
  }

  private classroomReferences(rows: Record<string, unknown>[]) {
    const unique = new Map<
      string,
      {
        schoolId: number;
        academicYear: number;
        semester: number;
        gradeLevelId: number;
        roomNumber: number;
      }
    >();
    for (const row of rows) {
      const key = this.classroomReferenceKey(row);
      if (!key) continue;
      const [schoolId, academicYear, semester, gradeLevelId, roomNumber] = JSON.parse(
        key,
      ) as number[];
      unique.set(key, { schoolId, academicYear, semester, gradeLevelId, roomNumber });
    }
    return [...unique.values()];
  }

  private async configuredClassroomKeys(
    rows: Record<string, unknown>[],
    executor?: QueryExecutor,
  ): Promise<Set<string> | undefined> {
    const references = this.classroomReferences(rows);
    const finder = this.importsRepository.findExistingClassroomReferences?.bind(
      this.importsRepository,
    );
    if (!finder) {
      // Isolated legacy unit mocks predate the canonical lookup. Production
      // always injects ImportsRepository and therefore always enforces it.
      return undefined;
    }
    const existing = await finder(references, executor);
    return new Set(
      existing.map((reference) =>
        JSON.stringify([
          Number(reference.school_id),
          Number(reference.academic_year),
          Number(reference.semester),
          Number(reference.grade_level_id),
          Number(reference.room_number),
        ]),
      ),
    );
  }

  private numericDbReferenceIds(rows: Record<string, unknown>[], column: string): number[] {
    return [
      ...new Set(
        rows
          .map((row) => Number(this.normalizePositiveInteger(row[column])))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    ];
  }

  private async resolveSchoolRosterImportContext(
    input: SchoolRosterImportContext | undefined,
    actor: AuthenticatedRequestUser | undefined,
  ): Promise<SchoolRosterImportContextRow | null> {
    const values = [input?.schoolId, input?.schoolTermId, input?.classroomId];
    if (values.every((value) => value == null)) return null;
    if (values.some((value) => value == null)) {
      throw new BadRequestException('กรุณาเลือกโรงเรียน ภาคเรียน และห้องเรียนให้ครบ');
    }

    const context = await this.importsRepository.findSchoolRosterImportContext(
      input!.schoolId!,
      input!.schoolTermId!,
      input!.classroomId!,
    );
    if (!context) {
      throw new BadRequestException('โรงเรียน ภาคเรียน หรือห้องเรียนไม่สัมพันธ์กัน');
    }
    if (!context.legacy_room_number) {
      throw new BadRequestException(
        'ห้องนี้ยังไม่มีเลขห้องสำหรับ enrollment กรุณากำหนดรหัสห้องเป็นจำนวนเต็มบวก',
      );
    }

    const mappedContext = {
      SchoolID_Onec: context.school_id,
      AcademicYear_Onec: context.academic_year,
      Semester_Onec: context.semester,
      GradeLevelID_Onec: context.grade_level_id,
      RoomID_Onec: context.legacy_room_number,
    };
    this.assertActorImportScope(
      actor,
      [mappedContext],
      {
        SchoolID_Onec: 'SchoolID_Onec',
        GradeLevelID_Onec: 'GradeLevelID_Onec',
        RoomID_Onec: 'RoomID_Onec',
      },
      [
        {
          id: context.school_id,
          province: context.province,
          district: context.district,
          sub_district: context.sub_district,
        },
      ],
    );
    return context;
  }

  private applySchoolRosterImportContext(
    rows: Record<string, unknown>[],
    context: SchoolRosterImportContextRow | null,
  ): Record<string, unknown>[] {
    if (!context) return rows;
    return rows.map((row) => ({
      ...row,
      SchoolID_Onec: context.school_id,
      AcademicYear_Onec: context.academic_year,
      Semester_Onec: context.semester,
      GradeLevelID_Onec: context.grade_level_id,
      RoomID_Onec: context.legacy_room_number,
      school_term_id: Number(context.school_term_id),
      classroom_id: Number(context.classroom_id),
    }));
  }

  /**
   * Codes usable as a real student status for import. A placeholder row whose
   * category is UNMATCHED (e.g. seeded "ยังไม่ได้จับคู่") exists in master data but
   * must still be treated as not mapped, otherwise quarantined rows would
   * auto-pass retry without any correction.
   */
  private mappedStudentStatusCodes(statuses: ImportReferenceRow[]): Set<number> {
    return new Set(
      statuses
        .filter((status) => status.category !== 'UNMATCHED')
        .map((status) => Number(status.id)),
    );
  }

  private importStatusLabel(status?: {
    label?: string | null;
    category?: string | null;
  }): string | null {
    if (!status?.label || status.category === 'UNMATCHED') return null;
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
      oldValue: normalizeScalar(originalValues[field]) || '-',
      newValue: normalizeScalar(values[field]) || '-',
    }));
  }

  private toChangedFieldDetails(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const detail = item as Record<string, unknown>;
      const label = normalizeScalar(detail.label);
      if (!label) return [];
      return [
        {
          label,
          oldValue: normalizeScalar(detail.oldValue) || '-',
          newValue: normalizeScalar(detail.newValue) || '-',
        },
      ];
    });
  }

  private toQuarantineLookupMap(rows: QuarantineLookupRow[]): Map<string, QuarantineLookupMeta> {
    return new Map(
      rows.map((row) => {
        const variant = normalizeScalar(row.badge_variant) as QuarantineBadgeVariant;
        return [
          String(row.code),
          {
            label: normalizeScalar(row.label_th) || String(row.code),
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
      const nextValue = normalizeScalar(incoming[column]);
      return nextValue.length > 0 && nextValue !== normalizeScalar(existing[column]);
    }).map(({ label }) => label);
  }

  private csvCell(value: unknown): string {
    const text = normalizeScalar(value);
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
    const workbook = xlsx.read(file.buffer, {
      type: 'buffer',
      raw: true,
      sheetRows: MAX_IMPORT_ROWS + 2,
    });
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

  private resolveCatalogMapping(
    target: ImportCatalogTarget,
    mapping: Record<string, string>,
    data: SheetRow[],
  ): Record<string, string> {
    const definition = getImportTargetDefinition(target);
    if (!definition) throw new BadRequestException('ไม่รองรับประเภทข้อมูลนำเข้า');
    const allowedFields = new Set(definition.fields.map((catalogField) => catalogField.key));
    const invalidFields = Object.keys(mapping).filter((key) => !allowedFields.has(key));
    if (invalidFields.length > 0) {
      throw new BadRequestException(`พบช่องข้อมูลที่ไม่อนุญาต: ${invalidFields.join(', ')}`);
    }
    if (Object.keys(mapping).length > 0) {
      this.assertUniqueMappedHeaders(mapping);
      return mapping;
    }
    const normalizedHeaders = new Map(
      this.getWorksheetHeaders(data).map((header) => [this.normalizeHeader(header), header]),
    );
    const usedHeaders = new Set<string>();
    const resolved: Record<string, string> = {};
    for (const catalogField of definition.fields) {
      const header = catalogField.aliases
        .map((alias) => normalizedHeaders.get(this.normalizeHeader(alias)))
        .find(
          (candidate): candidate is string =>
            typeof candidate === 'string' && !usedHeaders.has(candidate),
        );
      if (header) {
        resolved[catalogField.key] = header;
        usedHeaders.add(header);
      }
    }
    return resolved;
  }

  private parseStructureImportRows(
    data: SheetRow[],
    mapping: Record<string, string>,
  ): StructureImportRow[] {
    return data.map((source, index) => ({
      rowNumber: index + 2,
      values: Object.fromEntries(
        Object.entries(mapping).map(([field, header]) => [field, normalizeScalar(source[header])]),
      ),
    }));
  }

  private catalogUnmappedHeaders(data: SheetRow[], mapping: Record<string, string>): string[] {
    const mappedHeaders = new Set(Object.values(mapping));
    return this.getWorksheetHeaders(data).filter((header) => !mappedHeaders.has(header));
  }

  private parseTeacherImportRows(
    data: SheetRow[],
    requestedMapping: Record<string, string> = {},
  ): TeacherImportRow[] {
    const mapping = this.resolveCatalogMapping('school_teacher_membership', requestedMapping, data);
    const citizenIdHeader = mapping.citizenId;
    if (!citizenIdHeader) {
      throw new BadRequestException('ไม่พบคอลัมน์ citizenId หรือ เลขประจำตัวประชาชนครู');
    }
    const startedOnHeader = mapping.startedOn;
    return data.map((row, index) => ({
      rowNumber: index + 2,
      citizenId: normalizeScalar(row[citizenIdHeader]),
      startedOn: startedOnHeader ? normalizeScalar(row[startedOnHeader]) || null : null,
    }));
  }

  private isValidIsoDate(value: string | null): boolean {
    if (!value) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  private async assertTeacherImportSchoolScope(
    schoolId: number,
    actor: AuthenticatedRequestUser,
  ): Promise<void> {
    const schoolDetails = await this.importsRepository.findSchoolScopeDetails([schoolId]);
    if (schoolDetails.length !== 1) throw new NotFoundException('ไม่พบโรงเรียน');
    this.assertActorImportScope(
      actor,
      [{ SchoolID_Onec: schoolId }],
      { SchoolID_Onec: 'SchoolID_Onec' },
      schoolDetails,
    );
  }

  private teacherImportIssue(
    row: TeacherImportRow,
    duplicateCitizenIds: ReadonlySet<string>,
    candidate?: {
      is_eligible: boolean;
      is_active_member: boolean;
    },
  ): { reason: ImportQuarantineReason | null; label: string | null; skip: boolean } {
    if (!row.citizenId) {
      return {
        reason: 'BLANK_TEACHER_CITIZEN_ID',
        label: 'ไม่มีเลขประจำตัวประชาชนครู',
        skip: false,
      };
    }
    if (!this.isValidIsoDate(row.startedOn)) {
      return {
        reason: 'INVALID_TEACHER_START_DATE',
        label: 'วันที่เริ่มปฏิบัติงานไม่ถูกต้อง',
        skip: false,
      };
    }
    if (duplicateCitizenIds.has(row.citizenId)) {
      return { reason: 'DUPLICATE_TEACHER_ROW', label: 'ครูซ้ำในไฟล์', skip: false };
    }
    if (!candidate) {
      return { reason: 'TEACHER_NOT_FOUND', label: 'ไม่พบครูในระบบ', skip: false };
    }
    if (!candidate.is_eligible) {
      return { reason: 'INACTIVE_TEACHER', label: 'ครูคนนี้ไม่ได้เปิดใช้งาน', skip: false };
    }
    if (candidate.is_active_member) return { reason: null, label: null, skip: true };
    return { reason: null, label: null, skip: false };
  }

  async previewTeacherImport(
    file: Express.Multer.File,
    schoolId: number,
    actor: AuthenticatedRequestUser,
    requestedMapping: Record<string, string> = {},
  ): Promise<TeacherImportPreviewResult> {
    await this.assertTeacherImportSchoolScope(schoolId, actor);
    const rows = this.parseTeacherImportRows(this.readWorksheetRows(file), requestedMapping);
    if (rows.length === 0)
      throw new BadRequestException('The uploaded file is empty or unreadable');
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (row.citizenId) counts.set(row.citizenId, (counts.get(row.citizenId) ?? 0) + 1);
    }
    const duplicates = new Set(
      [...counts].filter(([, count]) => count > 1).map(([citizenId]) => citizenId),
    );
    const candidates = await this.importsRepository.findTeacherImportCandidates(
      [...counts.keys()],
      schoolId,
    );
    const candidatesByCitizenId = new Map(
      candidates.map((candidate) => [candidate.citizen_id, candidate]),
    );
    let rowsReady = 0;
    let rowsSkipped = 0;
    let rowsToQuarantine = 0;
    const sampleRows = rows.slice(0, IMPORT_PREVIEW_SAMPLE_LIMIT).map((row) => {
      const candidate = candidatesByCitizenId.get(row.citizenId);
      const issue = this.teacherImportIssue(row, duplicates, candidate);
      if (issue.reason) rowsToQuarantine += 1;
      else if (issue.skip) rowsSkipped += 1;
      else rowsReady += 1;
      return {
        rowNumber: row.rowNumber,
        citizenId: row.citizenId || '-',
        displayName: candidate?.display_name ?? '-',
        action: issue.reason
          ? ('quarantine' as const)
          : issue.skip
            ? ('skip' as const)
            : ('insert' as const),
        issue: issue.label,
      };
    });
    for (const row of rows.slice(IMPORT_PREVIEW_SAMPLE_LIMIT)) {
      const issue = this.teacherImportIssue(
        row,
        duplicates,
        candidatesByCitizenId.get(row.citizenId),
      );
      if (issue.reason) rowsToQuarantine += 1;
      else if (issue.skip) rowsSkipped += 1;
      else rowsReady += 1;
    }
    return {
      target: 'school_teacher_membership',
      rowsProcessed: rows.length,
      rowsReady,
      rowsSkipped,
      rowsToQuarantine,
      sampleRows,
    };
  }

  async processTeacherImport(
    file: Express.Multer.File,
    schoolId: number,
    actor: AuthenticatedRequestUser,
    auditMeta: { ip?: string | null } = {},
    requestedMapping: Record<string, string> = {},
  ) {
    await this.assertTeacherImportSchoolScope(schoolId, actor);
    const rows = this.parseTeacherImportRows(this.readWorksheetRows(file), requestedMapping);
    if (rows.length === 0)
      throw new BadRequestException('The uploaded file is empty or unreadable');
    const actorUserId = resolveAuditActorId(actor);
    const batchId = await this.importsRepository.createImportBatch({
      target: 'school_teacher_membership',
      sourceSha256: createHash('sha256').update(file.buffer).digest('hex'),
      scopeSnapshot: { ...actor.data_scope, selectedSchoolId: schoolId },
      totalRows: rows.length,
      actorUserId,
    });
    try {
      return await this.importsRepository.withTransaction(async (executor) => {
        const counts = new Map<string, number>();
        for (const row of rows) {
          if (row.citizenId) counts.set(row.citizenId, (counts.get(row.citizenId) ?? 0) + 1);
        }
        const duplicates = new Set(
          [...counts].filter(([, count]) => count > 1).map(([citizenId]) => citizenId),
        );
        const candidates = await this.importsRepository.findTeacherImportCandidates(
          [...counts.keys()],
          schoolId,
          executor,
        );
        const candidatesByCitizenId = new Map(
          candidates.map((candidate) => [candidate.citizen_id, candidate]),
        );
        let inserted = 0;
        let skipped = 0;
        let quarantined = 0;
        for (const row of rows) {
          const candidate = candidatesByCitizenId.get(row.citizenId);
          const issue = this.teacherImportIssue(row, duplicates, candidate);
          if (issue.reason) {
            await this.importsRepository.quarantineImportRow(
              {
                batchId,
                schoolId,
                sourceRowNumber: row.rowNumber,
                rowFingerprint: this.fingerprint({
                  target: 'school_teacher_membership',
                  schoolId,
                  citizenId: row.citizenId,
                  startedOn: row.startedOn,
                }),
                reasonCode: issue.reason,
                mappedValues: { citizenId: row.citizenId, startedOn: row.startedOn },
                actorUserId,
              },
              executor,
            );
            quarantined += 1;
            continue;
          }
          if (issue.skip || !candidate) {
            skipped += 1;
            continue;
          }
          const membershipId = await this.importsRepository.insertTeacherImportMembership(
            {
              schoolId,
              teacherId: Number(candidate.teacher_id),
              startedOn: row.startedOn,
              actorUserId,
            },
            executor,
          );
          if (membershipId) inserted += 1;
          else skipped += 1;
        }
        await this.importsRepository.completeImportBatch(
          batchId,
          { importedRows: inserted, quarantinedRows: quarantined },
          executor,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId,
            actorLabel: this.actorLabel(actor),
            action: 'DATA_IMPORT',
            targetType: 'school_teacher_memberships',
            targetId: batchId,
            metadata: {
              schoolId,
              rowsProcessed: rows.length,
              rowsInserted: inserted,
              rowsSkipped: skipped,
              rowsQuarantined: quarantined,
            },
            ip: auditMeta.ip ?? null,
          },
          executor,
        );
        return {
          success: true,
          batchId,
          rowsProcessed: rows.length,
          rowsInserted: inserted,
          rowsSkipped: skipped,
          rowsQuarantined: quarantined,
        };
      });
    } catch (error) {
      await this.importsRepository.failImportBatch(batchId);
      throw error;
    }
  }

  private async assertSchoolTermImportContext(
    schoolId: number,
    schoolTermId: number,
    actor: AuthenticatedRequestUser,
  ): Promise<void> {
    await this.assertTeacherImportSchoolScope(schoolId, actor);
    const context = await this.importsRepository.findSchoolTermImportContext(
      schoolId,
      schoolTermId,
    );
    if (!context) {
      throw new NotFoundException('ไม่พบภาคเรียนในโรงเรียนที่เลือก');
    }
  }

  private async assertClassroomImportContext(
    schoolId: number,
    schoolTermId: number,
    classroomId: number,
    actor: AuthenticatedRequestUser,
  ): Promise<void> {
    await this.assertTeacherImportSchoolScope(schoolId, actor);
    const context = await this.importsRepository.findSchoolRosterImportContext(
      schoolId,
      schoolTermId,
      classroomId,
    );
    if (!context) {
      throw new NotFoundException('ไม่พบห้องเรียนในภาคเรียนและโรงเรียนที่เลือก');
    }
  }

  private classroomCodeKey(gradeLevelId: number, roomCode: string): string {
    return `${gradeLevelId}:${roomCode.trim().toLocaleLowerCase('th')}`;
  }

  private async evaluateClassroomRows(
    rows: StructureImportRow[],
    schoolId: number,
    schoolTermId: number,
    executor?: QueryExecutor,
  ): Promise<StructureRowEvaluation[]> {
    const gradeIds = [
      ...new Set(
        rows
          .map((row) => Number(row.values.gradeLevelId))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    ];
    const [grades, existing] = await Promise.all([
      this.importsRepository.findGradeLabels(gradeIds, executor),
      this.importsRepository.findClassroomImportReferences(schoolId, schoolTermId, executor),
    ]);
    const knownGrades = new Set(grades.map((grade) => Number(grade.id)));
    const existingByCode = new Map(
      existing.map((classroom) => [
        this.classroomCodeKey(Number(classroom.grade_level_id), classroom.room_code),
        classroom,
      ]),
    );
    const codeCounts = new Map<string, number>();
    for (const row of rows) {
      const gradeLevelId = Number(row.values.gradeLevelId);
      const roomCode = row.values.roomCode?.trim() ?? '';
      if (Number.isInteger(gradeLevelId) && gradeLevelId > 0 && roomCode) {
        const key = this.classroomCodeKey(gradeLevelId, roomCode);
        codeCounts.set(key, (codeCounts.get(key) ?? 0) + 1);
      }
    }

    return rows.map((row) => {
      const gradeLevelId = Number(row.values.gradeLevelId);
      const roomCode = row.values.roomCode?.trim() ?? '';
      const roomNumber = Number(roomCode);
      const roomName = row.values.roomName?.trim() ?? '';
      if (
        !Number.isInteger(gradeLevelId) ||
        gradeLevelId <= 0 ||
        !/^[1-9][0-9]*$/.test(roomCode) ||
        !Number.isInteger(roomNumber) ||
        roomNumber > 2_147_483_647 ||
        roomName.length > 120
      ) {
        return {
          row,
          action: 'quarantine',
          reason: 'MISSING_IMPORT_FIELD',
          issue: 'ข้อมูลระดับชั้นหรือรหัสห้องไม่ครบ/ไม่ถูกต้อง',
        };
      }
      if (!knownGrades.has(gradeLevelId)) {
        return {
          row,
          action: 'quarantine',
          reason: 'GRADE_NOT_FOUND',
          issue: 'ไม่พบระดับชั้นในข้อมูลหลัก',
        };
      }
      const codeKey = this.classroomCodeKey(gradeLevelId, roomCode);
      if ((codeCounts.get(codeKey) ?? 0) > 1) {
        return {
          row,
          action: 'quarantine',
          reason: 'DUPLICATE_ROW_IN_FILE',
          issue: 'พบห้องเรียนซ้ำในไฟล์',
        };
      }
      const byCode = existingByCode.get(codeKey);
      if (byCode) return { row, action: 'skip', reason: null, issue: null };
      return {
        row,
        action: 'insert',
        reason: null,
        issue: null,
        resolved: { gradeLevelId },
      };
    });
  }

  private async evaluateAssignmentRows(
    rows: StructureImportRow[],
    schoolId: number,
    classroomId: number,
    executor?: QueryExecutor,
  ): Promise<StructureRowEvaluation[]> {
    const citizenIds = [
      ...new Set(rows.map((row) => row.values.citizenId?.trim()).filter(Boolean)),
    ];
    const subjectIds = [
      ...new Set(
        rows
          .map((row) => Number(row.values.subjectId))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    ];
    const [memberships, knownSubjectIds, existing] = await Promise.all([
      this.importsRepository.findAssignmentTeacherReferences(schoolId, citizenIds, executor),
      this.importsRepository.findExistingSubjectIds(subjectIds, executor),
      this.importsRepository.findClassroomAssignmentReferences(schoolId, classroomId, executor),
    ]);
    const membershipByCitizenId = new Map(
      memberships.map((membership) => [membership.citizen_id, membership.membership_id]),
    );
    const knownSubjects = new Set(knownSubjectIds);
    const duplicateCounts = new Map<string, number>();
    for (const row of rows) {
      const citizenId = row.values.citizenId?.trim() ?? '';
      const kind = row.values.assignmentKind?.trim().toUpperCase() ?? '';
      const subjectId = Number(row.values.subjectId);
      const key = kind === 'HOMEROOM' ? 'HOMEROOM' : `${kind}:${citizenId}:${subjectId}`;
      duplicateCounts.set(key, (duplicateCounts.get(key) ?? 0) + 1);
    }
    return rows.map((row) => {
      const citizenId = row.values.citizenId?.trim() ?? '';
      const assignmentKind = row.values.assignmentKind?.trim().toUpperCase() ?? '';
      const subjectRaw = row.values.subjectId?.trim() ?? '';
      const subjectId = subjectRaw ? Number(subjectRaw) : null;
      const effectiveOn = row.values.effectiveOn?.trim() || null;
      const effectiveUntil = row.values.effectiveUntil?.trim() || null;
      if (!citizenId) {
        return {
          row,
          action: 'quarantine',
          reason: 'MISSING_IMPORT_FIELD',
          issue: 'ไม่มีเลขประจำตัวประชาชนครู',
        };
      }
      if (assignmentKind !== 'HOMEROOM' && assignmentKind !== 'SUBJECT') {
        return {
          row,
          action: 'quarantine',
          reason: 'INVALID_ASSIGNMENT_KIND',
          issue: 'ประเภทการมอบหมายต้องเป็น HOMEROOM หรือ SUBJECT',
        };
      }
      if (
        (assignmentKind === 'HOMEROOM' && subjectId !== null) ||
        (assignmentKind === 'SUBJECT' &&
          (subjectId === null || !Number.isInteger(subjectId) || subjectId <= 0))
      ) {
        return {
          row,
          action: 'quarantine',
          reason: 'MISSING_IMPORT_FIELD',
          issue: 'ครูประจำชั้นต้องไม่มีวิชา และครูผู้สอนต้องระบุรหัสวิชา',
        };
      }
      if (
        !this.isValidIsoDate(effectiveOn) ||
        !this.isValidIsoDate(effectiveUntil) ||
        (effectiveOn && effectiveUntil && effectiveUntil < effectiveOn)
      ) {
        return {
          row,
          action: 'quarantine',
          reason: 'INVALID_IMPORT_DATE',
          issue: 'ช่วงวันที่การมอบหมายไม่ถูกต้อง',
        };
      }
      const teacherMembershipId = membershipByCitizenId.get(citizenId);
      if (!teacherMembershipId) {
        return {
          row,
          action: 'quarantine',
          reason: 'TEACHER_MEMBERSHIP_NOT_FOUND',
          issue: 'ไม่พบครูในรายชื่อครูของโรงเรียน',
        };
      }
      if (subjectId !== null && !knownSubjects.has(subjectId)) {
        return {
          row,
          action: 'quarantine',
          reason: 'SUBJECT_NOT_FOUND',
          issue: 'ไม่พบวิชาในข้อมูลหลัก',
        };
      }
      const duplicateKey =
        assignmentKind === 'HOMEROOM' ? 'HOMEROOM' : `${assignmentKind}:${citizenId}:${subjectId}`;
      if ((duplicateCounts.get(duplicateKey) ?? 0) > 1) {
        return {
          row,
          action: 'quarantine',
          reason: 'DUPLICATE_ROW_IN_FILE',
          issue: 'พบการมอบหมายซ้ำในไฟล์',
        };
      }
      const existingMatch = existing.find((assignment) =>
        assignmentKind === 'HOMEROOM'
          ? assignment.assignment_kind === 'HOMEROOM'
          : assignment.assignment_kind === 'SUBJECT' &&
            assignment.teacher_membership_id === teacherMembershipId &&
            Number(assignment.subject_id) === subjectId,
      );
      if (existingMatch) {
        if (
          assignmentKind === 'HOMEROOM' &&
          existingMatch.teacher_membership_id !== teacherMembershipId
        ) {
          return {
            row,
            action: 'quarantine',
            reason: 'ASSIGNMENT_CONFLICT',
            issue: 'ห้องเรียนมีครูประจำชั้นที่ใช้งานอยู่แล้ว',
          };
        }
        return { row, action: 'skip', reason: null, issue: null };
      }
      return {
        row,
        action: 'insert',
        reason: null,
        issue: null,
        resolved: {
          teacherMembershipId,
          subjectId,
          assignmentKind,
        },
      };
    });
  }

  private async previewStructureImport(
    file: Express.Multer.File,
    target: 'school_classroom' | 'classroom_teacher_assignment',
    mappingStr: string,
    actor: AuthenticatedRequestUser,
    context: CatalogImportContext,
  ): Promise<CatalogStructureImportPreviewResult> {
    const schoolId = this.requirePositiveContextId(context, 'schoolId');
    const schoolTermId = this.requirePositiveContextId(context, 'schoolTermId');
    const classroomId =
      target === 'classroom_teacher_assignment'
        ? this.requirePositiveContextId(context, 'classroomId')
        : undefined;
    if (classroomId) {
      await this.assertClassroomImportContext(schoolId, schoolTermId, classroomId, actor);
    } else {
      await this.assertSchoolTermImportContext(schoolId, schoolTermId, actor);
    }
    const data = this.readWorksheetRows(file);
    if (data.length === 0)
      throw new BadRequestException('The uploaded file is empty or unreadable');
    const mapping = this.resolveCatalogMapping(target, this.parseMapping(mappingStr), data);
    const definition = getImportTargetDefinition(target)!;
    const missingRequiredColumns = definition.fields
      .filter((catalogField) => catalogField.required && !mapping[catalogField.key])
      .map((catalogField) => catalogField.key);
    const rows = this.parseStructureImportRows(data, mapping);
    const evaluations =
      target === 'school_classroom'
        ? await this.evaluateClassroomRows(rows, schoolId, schoolTermId)
        : await this.evaluateAssignmentRows(rows, schoolId, classroomId!);
    const rowsReady = evaluations.filter((row) => row.action === 'insert').length;
    const rowsSkipped = evaluations.filter((row) => row.action === 'skip').length;
    const rowsToQuarantine = evaluations.filter((row) => row.action === 'quarantine').length;
    return {
      target,
      targetLabel: definition.label,
      canImport: missingRequiredColumns.length === 0,
      headers: this.getWorksheetHeaders(data),
      mapping,
      rowsProcessed: rows.length,
      rowsReady,
      rowsSkipped,
      rowsToInsert: rowsReady,
      rowsToQuarantine,
      missingRequiredColumns,
      unmappedHeaders: this.catalogUnmappedHeaders(data, mapping),
      sampleRows: evaluations.slice(0, IMPORT_PREVIEW_SAMPLE_LIMIT).map((evaluation) => ({
        rowNumber: evaluation.row.rowNumber,
        action: evaluation.action,
        values: evaluation.row.values,
        issues: evaluation.issue ? [evaluation.issue] : [],
      })),
    };
  }

  private async processStructureImport(
    file: Express.Multer.File,
    target: 'school_classroom' | 'classroom_teacher_assignment',
    mappingStr: string,
    actor: AuthenticatedRequestUser,
    auditMeta: { ip?: string | null },
    context: CatalogImportContext,
  ) {
    const preview = await this.previewStructureImport(file, target, mappingStr, actor, context);
    if (!preview.canImport) {
      throw new BadRequestException(
        `คอลัมน์บังคับไม่ครบ: ${preview.missingRequiredColumns.join(', ')}`,
      );
    }
    const schoolId = this.requirePositiveContextId(context, 'schoolId');
    const schoolTermId = this.requirePositiveContextId(context, 'schoolTermId');
    const classroomId =
      target === 'classroom_teacher_assignment'
        ? this.requirePositiveContextId(context, 'classroomId')
        : undefined;
    const mapping = preview.mapping;
    const rows = this.parseStructureImportRows(this.readWorksheetRows(file), mapping);
    const actorUserId = resolveAuditActorId(actor);
    const batchId = await this.importsRepository.createImportBatch({
      target,
      sourceSha256: createHash('sha256').update(file.buffer).digest('hex'),
      scopeSnapshot: {
        ...actor.data_scope,
        selectedSchoolId: schoolId,
        selectedSchoolTermId: schoolTermId,
        ...(classroomId ? { selectedClassroomId: classroomId } : {}),
      },
      totalRows: rows.length,
      actorUserId,
    });
    try {
      return await this.importsRepository.withTransaction(async (executor) => {
        const evaluations =
          target === 'school_classroom'
            ? await this.evaluateClassroomRows(rows, schoolId, schoolTermId, executor)
            : await this.evaluateAssignmentRows(rows, schoolId, classroomId!, executor);
        let inserted = 0;
        let skipped = 0;
        let quarantined = 0;
        for (const evaluation of evaluations) {
          if (evaluation.reason) {
            await this.importsRepository.quarantineImportRow(
              {
                batchId,
                schoolId,
                sourceRowNumber: evaluation.row.rowNumber,
                rowFingerprint: this.fingerprint({
                  target,
                  schoolId,
                  schoolTermId,
                  classroomId,
                  values: evaluation.row.values,
                }),
                reasonCode: evaluation.reason,
                mappedValues: {
                  ...evaluation.row.values,
                  schoolId,
                  schoolTermId,
                  ...(classroomId ? { classroomId } : {}),
                },
                actorUserId,
              },
              executor,
            );
            quarantined += 1;
            continue;
          }
          if (evaluation.action === 'skip') {
            skipped += 1;
            continue;
          }
          let insertedId: string | null;
          if (target === 'school_classroom') {
            insertedId = await this.importsRepository.insertClassroomImportRow(
              {
                schoolId,
                schoolTermId,
                gradeLevelId: evaluation.resolved!.gradeLevelId!,
                roomCode: evaluation.row.values.roomCode.trim(),
                roomName: evaluation.row.values.roomName?.trim() || null,
                actorUserId,
              },
              executor,
            );
          } else {
            insertedId = await this.importsRepository.insertClassroomAssignmentImportRow(
              {
                schoolId,
                classroomId: classroomId!,
                teacherMembershipId: evaluation.resolved!.teacherMembershipId!,
                subjectId: evaluation.resolved!.subjectId ?? null,
                assignmentKind: evaluation.resolved!.assignmentKind!,
                effectiveOn: evaluation.row.values.effectiveOn?.trim() || null,
                effectiveUntil: evaluation.row.values.effectiveUntil?.trim() || null,
                actorUserId,
              },
              executor,
            );
          }
          if (insertedId) inserted += 1;
          else skipped += 1;
        }
        await this.importsRepository.completeImportBatch(
          batchId,
          { importedRows: inserted, quarantinedRows: quarantined },
          executor,
        );
        await this.auditLog.recordAtomic(
          {
            actorUserId,
            actorLabel: this.actorLabel(actor),
            action: 'DATA_IMPORT',
            targetType:
              target === 'school_classroom' ? 'school_classrooms' : 'classroom_teacher_assignments',
            targetId: batchId,
            metadata: {
              target,
              schoolId,
              schoolTermId,
              ...(classroomId ? { classroomId } : {}),
              rowsProcessed: rows.length,
              rowsInserted: inserted,
              rowsSkipped: skipped,
              rowsQuarantined: quarantined,
            },
            ip: auditMeta.ip ?? null,
          },
          executor,
        );
        return {
          success: true,
          batchId,
          target,
          rowsProcessed: rows.length,
          rowsInserted: inserted,
          rowsUpdated: 0,
          rowsSkipped: skipped,
          rowsQuarantined: quarantined,
        };
      });
    } catch (error) {
      await this.importsRepository.failImportBatch(batchId);
      throw error;
    }
  }

  async previewCatalogImport(
    file: Express.Multer.File,
    target: string,
    mappingStr: string,
    actor: AuthenticatedRequestUser,
    context: CatalogImportContext,
  ) {
    if (!isImportCatalogTarget(target))
      throw new BadRequestException('ไม่รองรับประเภทข้อมูลนำเข้า');
    this.assertCatalogCapability(target, actor);
    if (target === 'student_term') {
      this.requirePositiveContextId(context, 'schoolId');
      this.requirePositiveContextId(context, 'schoolTermId');
      this.requirePositiveContextId(context, 'classroomId');
      return await this.previewImport(file, target, mappingStr, actor, context);
    }
    if (target === 'school_teacher_membership') {
      const schoolId = this.requirePositiveContextId(context, 'schoolId');
      const data = this.readWorksheetRows(file);
      const mapping = this.resolveCatalogMapping(target, this.parseMapping(mappingStr), data);
      const preview = await this.previewTeacherImport(file, schoolId, actor, mapping);
      return {
        ...preview,
        targetLabel: getImportTargetDefinition(target)!.label,
        canImport: Boolean(mapping.citizenId),
        headers: this.getWorksheetHeaders(data),
        mapping,
        rowsToInsert: preview.rowsReady,
        missingRequiredColumns: mapping.citizenId ? [] : ['citizenId'],
        unmappedHeaders: this.catalogUnmappedHeaders(data, mapping),
        sampleRows: preview.sampleRows.map((row) => ({
          ...row,
          values: { citizenId: row.citizenId, displayName: row.displayName },
          issues: row.issue ? [row.issue] : [],
        })),
      };
    }
    return await this.previewStructureImport(file, target, mappingStr, actor, context);
  }

  async processCatalogImport(
    file: Express.Multer.File,
    target: string,
    mappingStr: string,
    actor: AuthenticatedRequestUser,
    auditMeta: { ip?: string | null },
    context: CatalogImportContext,
    legacySchools?: string,
  ) {
    if (!isImportCatalogTarget(target))
      throw new BadRequestException('ไม่รองรับประเภทข้อมูลนำเข้า');
    this.assertCatalogCapability(target, actor);
    if (target === 'student_term') {
      this.requirePositiveContextId(context, 'schoolId');
      this.requirePositiveContextId(context, 'schoolTermId');
      this.requirePositiveContextId(context, 'classroomId');
      return await this.processImport(
        file,
        target,
        mappingStr,
        legacySchools,
        actor,
        auditMeta,
        context,
      );
    }
    if (target === 'school_teacher_membership') {
      const schoolId = this.requirePositiveContextId(context, 'schoolId');
      const data = this.readWorksheetRows(file);
      const mapping = this.resolveCatalogMapping(target, this.parseMapping(mappingStr), data);
      if (!mapping.citizenId) throw new BadRequestException('คอลัมน์บังคับไม่ครบ: citizenId');
      const result = await this.processTeacherImport(file, schoolId, actor, auditMeta, mapping);
      return { ...result, target, rowsUpdated: 0 };
    }
    return await this.processStructureImport(file, target, mappingStr, actor, auditMeta, context);
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
    const catalogFields = getImportTargetDefinition(target)?.fields ?? [];

    for (const column of candidates) {
      const aliases = catalogFields.find((field) => field.key === column)?.aliases ?? [column];
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
    const fullName = fullNameHeader ? normalizeScalar(row[fullNameHeader]) : '';
    if (fullName) {
      const parts = fullName.split(/\s+/u).filter(Boolean);
      if (!normalizeScalar(dbRow['FirstName_Onec'])) {
        dbRow['FirstName_Onec'] = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0];
      }
      if (!normalizeScalar(dbRow['LastName_Onec'])) {
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
      normalizeScalar(row.academic_year),
      normalizeScalar(row.semester),
      normalizeScalar(row.school_id),
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
                    : normalizeScalar(row[header]).slice(0, 80),
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
      const room = normalizeScalar(row[mapping['RoomID_Onec']]);
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
              value !== null && value !== undefined && normalizeScalar(value).length > 0,
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
    importContext?: SchoolRosterImportContext,
  ): Promise<ImportPreviewResult> {
    const validTarget = this.parseTarget(target);
    const parsedMapping = this.parseMapping(mappingStr);
    const data = this.readWorksheetRows(file);

    if (!data || data.length === 0) {
      throw new BadRequestException('The uploaded file is empty or unreadable');
    }

    const mapping = this.resolveImportMapping(validTarget, parsedMapping, data);
    this.assertMappedColumnsAllowed(validTarget, mapping);

    const context = await this.resolveSchoolRosterImportContext(importContext, actor);
    const requiredColumns = context ? ['PersonID_Onec'] : REQUIRED_IMPORT_COLUMNS[validTarget];
    const recommendedColumns = RECOMMENDED_IMPORT_COLUMNS[validTarget];
    const missingRequiredColumns = requiredColumns.filter((column) => !mapping[column]);
    const missingRecommendedColumns = context
      ? recommendedColumns.filter(
          (column) =>
            !mapping[column] &&
            ![
              'AcademicYear_Onec',
              'Semester_Onec',
              'SchoolID_Onec',
              'GradeLevelID_Onec',
              'RoomID_Onec',
            ].includes(column),
        )
      : recommendedColumns.filter((column) => !mapping[column]);
    const dbRows = this.applySchoolRosterImportContext(
      data.map((row) => this.buildImportDbRow(mapping, row)),
      context,
    );
    const schoolIds = this.numericDbReferenceIds(dbRows, 'SchoolID_Onec');
    if (validTarget === 'student_term' && !context) {
      const schoolDetails = await this.importsRepository.findSchoolScopeDetails(schoolIds);
      this.assertActorImportScope(actor, data, mapping, schoolDetails);
    }
    const rawPersonIds = dbRows.map((row) =>
      validTarget === 'student_term'
        ? this.normalizeNationalId(row['PersonID_Onec'])
        : normalizeScalar(row['PersonID_Onec']),
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
    const gradeIds = this.numericDbReferenceIds(dbRows, 'GradeLevelID_Onec');
    const statusCodes = this.numericDbReferenceIds(dbRows, 'StudentStatusID_Onec');
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
    const knownClassroomKeys =
      validTarget === 'student_term' ? await this.configuredClassroomKeys(dbRows) : undefined;
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
        const personId = normalizeScalar(dbRow['PersonID_Onec']);
        const schoolId = normalizeScalar(dbRow['SchoolID_Onec']);
        const rowKey =
          validTarget === 'student_term'
            ? this.studentTermKey(dbRow)
            : normalizeScalar(dbRow['PersonID_Onec']) || null;
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

        const gradeLevelId = normalizeScalar(dbRow['GradeLevelID_Onec']);
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
        const studentStatusCode = normalizeScalar(dbRow['StudentStatusID_Onec']);
        const studentStatus = statusLabels.get(Number(studentStatusCode));
        if (studentStatusCode && !mappedStatusCodes.has(Number(studentStatusCode))) {
          issues.push('สถานะนักเรียนยังไม่ได้จับคู่');
          action = 'quarantine';
        }
        const gradeRoomIssue = this.gradeRoomIssue(dbRow, knownGradeIds, knownClassroomKeys);
        if (gradeRoomIssue === 'GRADE_NOT_FOUND') {
          issues.push('ชั้นเรียนไม่ถูกต้องหรือไม่พบในข้อมูลหลัก');
          action = 'quarantine';
        } else if (gradeRoomIssue === 'ROOM_NOT_FOUND') {
          issues.push('รหัสห้องไม่ถูกต้องหรือไม่พบในข้อมูลหลัก');
          action = 'quarantine';
        }

        return {
          rowNumber: index + 2,
          status: action === 'skip' ? 'skipped' : action === 'quarantine' ? 'quarantine' : 'ready',
          action,
          issues,
          personIdMasked: this.maskIdentifier(dbRow['PersonID_Onec']),
          firstName: normalizeScalar(dbRow['FirstName_Onec']) || '-',
          lastName: normalizeScalar(dbRow['LastName_Onec']) || '-',
          schoolId: schoolId || '-',
          schoolName: schoolNames.get(Number(schoolId)) ?? '-',
          academicYear: normalizeScalar(dbRow['AcademicYear_Onec']) || '-',
          semester: normalizeScalar(dbRow['Semester_Onec']) || '-',
          gradeLevelId: gradeLevelId || '-',
          gradeLabel: gradeLabels.get(Number(gradeLevelId)) ?? '-',
          roomId: normalizeScalar(dbRow['RoomID_Onec']) || '-',
          changedFields,
          hasDifferentSchoolSnapshot,
          studentStatusCode: studentStatusCode || '-',
          studentStatusLabel: this.importStatusLabel(studentStatus) ?? 'ยังไม่ได้จับคู่',
          studentStatusCategory: studentStatus?.category ?? 'UNMATCHED',
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
      const studentStatusCode = normalizeScalar(dbRow['StudentStatusID_Onec']);
      if (studentStatusCode && !mappedStatusCodes.has(Number(studentStatusCode))) {
        rowsToQuarantine += 1;
        continue;
      }
      const gradeRoomIssue = this.gradeRoomIssue(dbRow, knownGradeIds, knownClassroomKeys);
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
    importContext?: SchoolRosterImportContext,
  ) {
    const validTarget = this.parseTarget(target);
    const parsedMapping = this.parseMapping(mappingStr);
    if (schoolsStr?.trim()) {
      throw new BadRequestException(
        'การนำเข้าไม่สามารถสร้างโรงเรียนใหม่ได้ กรุณาเพิ่มโรงเรียนผ่านขั้นตอน onboarding ก่อน',
      );
    }

    this.logger.log(`Parsing import file for target: ${validTarget}`);
    const data = this.readWorksheetRows(file);

    if (!data || data.length === 0) {
      throw new BadRequestException('The uploaded file is empty or unreadable');
    }

    const mapping = this.resolveImportMapping(validTarget, parsedMapping, data);
    this.assertMappedColumnsAllowed(validTarget, mapping);
    const context = await this.resolveSchoolRosterImportContext(importContext, actor);
    const requiredColumns = context ? ['PersonID_Onec'] : REQUIRED_IMPORT_COLUMNS[validTarget];
    const missingRequiredColumns = requiredColumns.filter((column) => !mapping[column]);
    if (missingRequiredColumns.length > 0) {
      throw new BadRequestException(`ไม่พบคอลัมน์บังคับ: ${missingRequiredColumns.join(', ')}`);
    }

    const mappedRows = this.applySchoolRosterImportContext(
      data.map((row) => this.buildImportDbRow(mapping, row)),
      context,
    );
    const knownSchoolIds = new Set<number>();
    let fileSchoolIds: number[] = [];
    const knownStudentStatusCodes = new Set<number>();
    const knownGradeIds = new Set<number>();
    let knownClassroomKeys: ReadonlySet<string> | undefined;
    if (validTarget === 'student_term') {
      fileSchoolIds = this.numericDbReferenceIds(mappedRows, 'SchoolID_Onec');
      const existingSchoolIds = await this.importsRepository.findExistingSchoolIds(fileSchoolIds);
      for (const schoolId of existingSchoolIds) {
        knownSchoolIds.add(schoolId);
      }
      const unresolvedSchoolIds = fileSchoolIds.filter((schoolId) => !knownSchoolIds.has(schoolId));
      if (unresolvedSchoolIds.length > 0) {
        throw new BadRequestException(
          `ไม่พบโรงเรียนในข้อมูลหลัก: ${unresolvedSchoolIds.join(', ')}`,
        );
      }
      const statusCodes = this.numericDbReferenceIds(mappedRows, 'StudentStatusID_Onec');
      const gradeIds = this.numericDbReferenceIds(mappedRows, 'GradeLevelID_Onec');
      const [statuses, grades] = await Promise.all([
        this.importsRepository.findStudentStatusLabels(statusCodes),
        this.importsRepository.findGradeLabels(gradeIds),
      ]);
      for (const code of this.mappedStudentStatusCodes(statuses)) {
        knownStudentStatusCodes.add(code);
      }
      for (const grade of grades) knownGradeIds.add(Number(grade.id));
      knownClassroomKeys = await this.configuredClassroomKeys(mappedRows);
      if (!context) {
        const schoolDetails = await this.importsRepository.findSchoolScopeDetails(fileSchoolIds);
        this.assertActorImportScope(actor, data, mapping, schoolDetails);
      }
    }

    this.logger.log(`Found ${data.length} rows. Mapping to ${validTarget}...`);
    const actorUserId = resolveAuditActorId(actor);
    const sourceSha256 = createHash('sha256').update(file.buffer).digest('hex');
    const batchId = await this.importsRepository.createImportBatch({
      target: validTarget,
      sourceSha256,
      scopeSnapshot: {
        ...(actor?.data_scope ?? {}),
        selectedSchoolIds: context ? [context.schoolId] : fileSchoolIds,
        ...(context
          ? {
              selectedSchoolId: context.schoolId,
              selectedSchoolTermId: context.schoolTermId,
              selectedClassroomId: context.classroomId,
            }
          : {}),
      },
      totalRows: data.length,
      actorUserId,
    });

    try {
      const result = await this.importsRepository.withTransaction(async (executor) => {
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
          const identifiersToCreate = new Map<string, string>();
          for (const row of mappedRows) {
            const normalized = this.normalizeNationalId(row['PersonID_Onec']);
            if (
              normalized &&
              !conflictingPersonIds.has(normalized) &&
              !resolvedPersonUuids.has(normalized) &&
              !identifiersToCreate.has(normalized)
            ) {
              identifiersToCreate.set(
                normalized,
                this.stringifyIdentifierValue(row['PersonID_Onec']),
              );
            }
          }
          const createdMatches =
            await this.importsRepository.bulkResolveOrCreatePersonsByNationalIds(
              [...identifiersToCreate].map(([identifierNormalized, identifierValue]) => ({
                identifierValue,
                identifierNormalized,
              })),
              executor,
            );
          for (const match of createdMatches) {
            resolvedPersonUuids.set(match.identifier_normalized, match.person_uuid);
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
          if (normalizeScalar(personId).length === 0) {
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
            const statusCode = normalizeScalar(dbRow['StudentStatusID_Onec']);
            if (statusCode && !knownStudentStatusCodes.has(Number(statusCode))) {
              await quarantine(dbRow, sourceRowNumber, 'UNMAPPED_STUDENT_STATUS');
              continue;
            }
            const gradeRoomIssue = this.gradeRoomIssue(dbRow, knownGradeIds, knownClassroomKeys);
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
          batchId,
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
            targetId: batchId,
            metadata: {
              batchId,
              ...(fileSchoolIds.length === 1 ? { schoolId: fileSchoolIds[0] } : {}),
              schoolIds: fileSchoolIds,
              target: this.getTargetLabel(validTarget),
              rowCount: result.rowsProcessed,
              rowsInserted: result.rowsInserted,
              rowsUpdated: result.rowsUpdated,
              rowsSkipped: result.rowsSkipped,
              rowsQuarantined: result.rowsQuarantined,
            },
            ip: auditMeta.ip ?? null,
          },
          executor,
        );
        return result;
      });
      return result;
    } catch (error) {
      try {
        await this.importsRepository.failImportBatch(batchId);
      } catch {
        this.logger.error(`Failed to persist FAILED status for ${validTarget} import batch`);
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
    const knownClassroomKeys = await this.configuredClassroomKeys([values], executor);
    const gradeRoomIssue = this.gradeRoomIssue(values, knownGradeIds, knownClassroomKeys);
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
      normalizeScalar(row.reason_label) || this.quarantineLookup(lookups.reason, reasonCode).label;
    const statusMeta = this.quarantineLookup(lookups.status, statusCode, 'secondary');
    const resolution = this.quarantineResolution({ ...row, reason_label: reasonLabel }, lookups);
    const editableValues = Object.fromEntries(
      resolution.editableFields.map((field) => [field, normalizeScalar(values[field])]),
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
      statusLabel: normalizeScalar(row.status_label) || statusMeta.label,
      statusBadgeVariant:
        (normalizeScalar(row.status_badge_variant) as QuarantineBadgeVariant) ||
        statusMeta.variant ||
        'secondary',
      target: String(row.target),
      student: {
        personIdMasked: this.maskIdentifier(values['PersonID_Onec']),
        firstName:
          // A quarantined teacher row has no name column — the citizen id is the
          // only identifier it carries, and it is masked like every other one.
          normalizeScalar(values['FirstName_Onec']) ||
          (values['citizenId'] ? this.maskIdentifier(values['citizenId']) : '') ||
          '-',
        lastName: normalizeScalar(values['LastName_Onec']) || '-',
        academicYear: normalizeScalar(values['AcademicYear_Onec']) || '-',
        semester: normalizeScalar(values['Semester_Onec']) || '-',
        province: typeof row.school_province === 'string' ? row.school_province : null,
        gradeLevelId: normalizeScalar(values['GradeLevelID_Onec']) || null,
        gradeLabel: typeof row.source_grade_label === 'string' ? row.source_grade_label : null,
        roomId: normalizeScalar(values['RoomID_Onec']) || null,
        studentStatusCode: normalizeScalar(values['StudentStatusID_Onec']) || null,
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
      normalizeScalar(values['FirstName_Onec']),
      normalizeScalar(values['LastName_Onec']),
    ]
      .filter(Boolean)
      .join(' ');
    return {
      studentName: studentName || '-',
      reasonLabel:
        normalizeScalar(row.reason_label) ||
        (lookups ? this.quarantineLookup(lookups.reason, reasonCode).label : reasonCode),
      schoolName: typeof row.school_name === 'string' ? row.school_name : undefined,
      sourceRowNumber:
        row.source_row_number === null || row.source_row_number === undefined
          ? undefined
          : Number(row.source_row_number),
      academicYear: normalizeScalar(values['AcademicYear_Onec']) || undefined,
      semester: normalizeScalar(values['Semester_Onec']) || undefined,
      gradeRoom:
        [
          typeof row.source_grade_label === 'string'
            ? row.source_grade_label
            : normalizeScalar(values['GradeLevelID_Onec']),
          normalizeScalar(values['RoomID_Onec']),
        ]
          .filter(Boolean)
          .join(' / ') || undefined,
      studentStatus:
        this.importStatusLabel({
          label: typeof row.source_status_label === 'string' ? row.source_status_label : null,
          category:
            typeof row.source_status_category === 'string' ? row.source_status_category : null,
        }) ||
        normalizeScalar(values['StudentStatusID_Onec']) ||
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
          normalizeScalar(row.reason_label) ||
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
        (field) => normalizeScalar(originalValues[field]) !== normalizeScalar(values[field]),
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
          firstName: normalizeScalar(values['FirstName_Onec']) || '-',
          lastName: normalizeScalar(values['LastName_Onec']) || '-',
          personIdMasked: this.maskIdentifier(values['PersonID_Onec']),
          schoolName:
            typeof row.school_name === 'string'
              ? row.school_name
              : normalizeScalar(values['SchoolID_Onec']) || '-',
          province: typeof row.school_province === 'string' ? row.school_province : null,
          gradeLevelId: importGradeId ? Number(importGradeId) : null,
          gradeLevelLabel:
            typeof row.source_grade_label === 'string' ? row.source_grade_label : null,
          roomId: normalizeScalar(values['RoomID_Onec']) || null,
          academicYear: normalizeScalar(values['AcademicYear_Onec']) || null,
          semester: normalizeScalar(values['Semester_Onec']) || null,
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
        const reasonCode = normalizeScalar(row.reason_code);
        const rowStatus = normalizeScalar(row.status);
        return [
          row.source_row_number,
          row.batch_created_at instanceof Date
            ? row.batch_created_at.toISOString()
            : normalizeScalar(row.batch_created_at),
          row.batch_id,
          normalizeScalar(values['FirstName_Onec']) || '-',
          normalizeScalar(values['LastName_Onec']) || '-',
          this.maskIdentifier(values['PersonID_Onec']),
          row.school_id,
          row.school_name,
          normalizeScalar(values['AcademicYear_Onec']) || '-',
          normalizeScalar(values['Semester_Onec']) || '-',
          normalizeScalar(row.reason_label) ||
            this.quarantineLookup(lookups.reason, reasonCode).label,
          normalizeScalar(row.status_label) ||
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
