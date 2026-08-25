import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { isRestrictedExecutive } from '../auth/permissions.constants';
import type { ConfigType } from '@nestjs/config';
import { CreateStudentDto } from './dto/create-student.dto';
import {
  DEFAULT_STUDENT_PAGE_SIZE,
  type GetStudentFilterOptionsQueryDto,
  type GetStudentsQueryDto,
} from './dto/students.dto';
import type { PiiRevealDto } from './dto/pii-reveal.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import type { DataScope } from '../common/utils/authorization';
import { buildStudentTermAddress } from '../common/utils/student-address.util';
import { buildSubjectStudentRef } from '../common/utils/pii-ref.util';
import { encodeMediaVersion } from '../common/utils/media-version.util';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { piiConfig } from '../config/pii.config';
import { StudentGeocodeCacheService } from '../student-geocode/student-geocode-cache.service';
import { processImageUpload } from '../common/file-upload/visit-photo.util';
import {
  FILE_STORAGE_ADAPTER,
  type FileServeResult,
  type FileStorageAdapter,
} from '../files/storage/file-storage.types';
import {
  PHASE1_MASKED_GROUPS,
  PII_FIELD_GROUPS,
  PII_REASON_CODES,
  PII_REASON_REQUIRES_NOTE,
  type PiiFieldGroup,
  type PiiReasonCode,
  hasPiiValue,
  maskPiiValue,
  maskNationalIdValue,
  normalizeNationalIdValue,
} from './pii-fields.config';
import { StudentsRepository } from './students.repository';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import type { StudentEnrollmentState, StudentListFilters } from './students.types';
import type { AuthenticatedRequestUser } from '../auth';

/** Metadata captured from the HTTP request for the PII access log. */
export interface PiiRevealRequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

function cleanPrefixedAddressText(
  prefix: string,
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  const normalized = value
    .trim()
    .replace(new RegExp(`^\\s*${prefix}\\s*`, 'u'), '')
    .trim();
  return normalized || null;
}

/**
 * Mask the Phase-1 sensitive groups (national id, passport) on a student-detail
 * row before it leaves the server, and report which fields were masked so the UI
 * can offer a reveal. Address is intentionally left untouched (Phase 1).
 */
function maskStudentDetail(
  row: Record<string, unknown>,
  activeGroups: string[] = [],
): Record<string, unknown> & { masked_fields: string[]; revealed_fields: string[] } {
  const masked: Record<string, unknown> = { ...row };
  const maskedFields: string[] = [];
  const revealedFields: string[] = [];

  for (const group of PHASE1_MASKED_GROUPS) {
    // Within an active reveal window the field stays unmasked for this actor —
    // no re-prompt, and GET does not write a new audit row.
    const active = activeGroups.includes(group);
    for (const column of PII_FIELD_GROUPS[group]) {
      if (!hasPiiValue(masked[column])) {
        continue;
      }
      if (column === 'PersonID_Onec') {
        masked[column] = normalizeNationalIdValue(masked[column]);
      }
      if (active) {
        revealedFields.push(column);
      } else {
        masked[column] =
          column === 'PersonID_Onec'
            ? maskNationalIdValue(masked[column])
            : maskPiiValue(masked[column]);
        maskedFields.push(column);
      }
    }
  }

  return { ...masked, masked_fields: maskedFields, revealed_fields: revealedFields };
}

function parseOptionalInteger(value?: string | number): number | undefined {
  if (!value || value === 'ALL' || value === 'all') {
    return undefined;
  }

  const parsed = Number.parseInt(String(value), 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function normalizeEnrollmentState(value?: string): StudentEnrollmentState {
  return value === 'all' ? 'all' : 'current-active';
}

function normalizeStudentStatusCode(
  value?: string | number,
  fallback?: string | number,
): number | undefined {
  return parseOptionalInteger(value ?? fallback);
}

function normalizeStudentListFilters(queryParams?: GetStudentsQueryDto): StudentListFilters {
  if (!queryParams) {
    return { enrollmentState: 'current-active' };
  }

  const searchTerm = queryParams.searchTerm?.trim();

  return {
    grade: queryParams.grade && queryParams.grade !== 'ALL' ? queryParams.grade : undefined,
    room: parseOptionalInteger(queryParams.room),
    schoolId: parseOptionalInteger(queryParams.schoolId),
    province: normalizeOptionalString(queryParams.province),
    district: normalizeOptionalString(queryParams.district),
    subDistrict: normalizeOptionalString(queryParams.subDistrict),
    searchTerm: searchTerm && searchTerm.length > 0 ? searchTerm : undefined,
    studentStatusCode: normalizeStudentStatusCode(
      queryParams.student_status_code,
      queryParams.studentStatusCode,
    ),
    enrollmentState: normalizeEnrollmentState(queryParams.enrollmentState),
    riskTier: queryParams.riskTier as StudentListFilters['riskTier'],
    page: queryParams.page && queryParams.page > 0 ? queryParams.page : 1,
    limit:
      queryParams.limit && queryParams.limit > 0 ? queryParams.limit : DEFAULT_STUDENT_PAGE_SIZE,
  };
}

function buildPaginationMeta(page: number, limit: number, totalCount: number) {
  return {
    page,
    limit,
    totalCount,
    totalPages: limit > 0 ? Math.ceil(totalCount / limit) : 0,
  };
}

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(
    private readonly studentsRepository: StudentsRepository,
    private readonly geocodeCache: StudentGeocodeCacheService,
    @Inject(piiConfig.KEY)
    private readonly piiRuntimeConfig: ConfigType<typeof piiConfig>,
    @Inject(FILE_STORAGE_ADAPTER)
    private readonly storage: FileStorageAdapter,
    private readonly riskProfileService: RiskProfileService,
  ) {}

  private async recalculateStudentRisk(studentUuid: string, reason: string): Promise<void> {
    try {
      await this.riskProfileService.requestStudentRecalculation([studentUuid], reason);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to recalculate student risk after management write: ${message}`);
    }
  }

  /**
   * Profile photo read. Goes through the app so the same scope check as the
   * rest of the record runs first; the adapter then returns a short-lived
   * signed URL (Supabase) or a file path (local disk).
   */
  async resolveStudentPhoto(
    id: string,
    actor?: AuthenticatedRequestUser,
    userScope?: DataScope,
  ): Promise<FileServeResult> {
    await this.findOne(id, actor, userScope);
    const personUuid = await this.studentsRepository.findPersonUuidByStudentUuid(id);
    const storageKey = personUuid
      ? await this.studentsRepository.findPersonPhotoStorageKey(personUuid)
      : null;
    if (!storageKey) throw new NotFoundException('ไม่พบรูปประจำตัวนักเรียน');
    const result = await this.storage.resolve(storageKey);
    if (!result) throw new NotFoundException('ไม่พบรูปประจำตัวนักเรียน');
    return result;
  }

  /**
   * Replaces or clears the profile photo. Upload first, write second, and the
   * replaced object is deleted only after the row points at the new one — so a
   * failed write never leaves an orphan and never loses the old photo.
   */
  async updateStudentPhoto(
    id: string,
    actor?: AuthenticatedRequestUser,
    userScope?: DataScope,
    file?: Express.Multer.File,
    removePhoto?: boolean,
  ) {
    if (file && removePhoto) {
      throw new BadRequestException('ไม่สามารถอัปโหลดและนำรูปออกพร้อมกันได้');
    }
    if (!file && !removePhoto) {
      throw new BadRequestException('กรุณาเลือกรูปหรือระบุการนำรูปออก');
    }
    await this.findOne(id, actor, userScope);
    const personUuid = await this.studentsRepository.findPersonUuidByStudentUuid(id);
    if (!personUuid) {
      throw new BadRequestException('นักเรียนคนนี้ยังไม่ได้เชื่อมกับข้อมูลบุคคลกลาง');
    }

    const replacedStorageKey = await this.studentsRepository.findPersonPhotoStorageKey(personUuid);
    const newStorageKey = file
      ? await processImageUpload(file, this.storage, 'student-photos')
      : null;

    try {
      await this.studentsRepository.updatePersonPhotoStorageKey(personUuid, newStorageKey);
    } catch (error) {
      if (newStorageKey) {
        await this.storage.delete(newStorageKey).catch(() => {
          this.logger.warn(`Unable to delete unused student photo for ${id}`);
        });
      }
      throw error;
    }

    if (replacedStorageKey) {
      await this.storage.delete(replacedStorageKey).catch(() => {
        this.logger.warn(`Unable to delete replaced student photo for ${id}`);
      });
    }
    return await this.findOne(id, actor, userScope);
  }

  private normalizeGuardians(guardians: UpdateStudentDto['guardians']) {
    if (guardians === undefined) return undefined;
    if (guardians.filter((guardian) => guardian.is_primary).length > 1) {
      throw new BadRequestException('เลือกผู้ติดต่อหลักได้เพียงคนเดียว');
    }
    return guardians.map((guardian) => {
      if (guardian.relation === 'GUARDIAN' && !guardian.relation_note?.trim()) {
        throw new BadRequestException('ผู้ปกครองที่ไม่ใช่บิดามารดาต้องระบุความสัมพันธ์');
      }
      const explicitFirstName = guardian.first_name?.trim();
      const explicitLastName = guardian.last_name?.trim();
      if (explicitFirstName) {
        if (!explicitLastName) {
          throw new BadRequestException('กรุณากรอกนามสกุลผู้ปกครอง');
        }
        return {
          ...guardian,
          first_name: explicitFirstName,
          last_name: explicitLastName,
          full_name: `${explicitFirstName} ${explicitLastName}`,
        };
      }
      const legacyFullName = guardian.full_name?.trim();
      if (!legacyFullName) {
        throw new BadRequestException('กรุณากรอกชื่อและนามสกุลผู้ปกครอง');
      }
      const nameParts = legacyFullName.split(/\s+/);
      const lastName = nameParts.length > 1 ? (nameParts.pop() ?? null) : null;
      return {
        ...guardian,
        first_name: nameParts.join(' '),
        last_name: lastName,
        full_name: legacyFullName,
      };
    });
  }

  async getManagementOptions(userScope?: DataScope) {
    const classrooms = await this.studentsRepository.listManagementClassrooms(userScope);
    return {
      data: {
        classrooms: classrooms.map((classroom) => ({
          id: classroom.id,
          schoolId: classroom.school_id,
          schoolName: classroom.school_name,
          schoolTermId: classroom.school_term_id,
          academicYear: classroom.academic_year,
          semester: classroom.semester,
          gradeLevelId: classroom.grade_level_id,
          gradeLabel: classroom.grade_label,
          roomCode: classroom.room_code,
          roomName: classroom.room_name,
        })),
      },
    };
  }

  async create(
    createStudentDto: CreateStudentDto,
    actor?: AuthenticatedRequestUser,
    userScope?: DataScope,
  ) {
    const normalizedGuardians = this.normalizeGuardians(createStudentDto.guardians);
    try {
      const created = await this.studentsRepository.createStudent(
        {
          ...createStudentDto,
          VillageNumber_Onec: cleanPrefixedAddressText('หมู่', createStudentDto.VillageNumber_Onec),
          Street_Onec: cleanPrefixedAddressText('ถนน', createStudentDto.Street_Onec),
          Soi_Onec: cleanPrefixedAddressText('ซอย', createStudentDto.Soi_Onec),
          Trok_Onec: cleanPrefixedAddressText('ตรอก', createStudentDto.Trok_Onec),
          guardians: normalizedGuardians,
        },
        resolveAuditActorId(actor),
        userScope,
      );
      if (!created) throw new NotFoundException('ไม่พบห้องเรียนในขอบเขตของคุณ');
      if ('invalidStatus' in created) {
        throw new BadRequestException('สถานะนักเรียนไม่พร้อมใช้งานหรือเป็นสถานะทางเทคนิค');
      }
      if ('conflict' in created) {
        throw new ConflictException('เลขบัตรประชาชนนี้มีข้อมูลนักเรียนอยู่ในระบบแล้ว');
      }
      await this.recalculateStudentRisk(created.studentUuid, 'student-create');
      return await this.findOne(created.studentUuid, actor, userScope);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : null;
      if (code === '23505') {
        throw new ConflictException('เลขประจำตัวนักเรียนหรือข้อมูลการลงทะเบียนซ้ำ');
      }
      if (code === '23503') {
        throw new BadRequestException('ข้อมูลห้องเรียนหรือสถานะนักเรียนไม่ถูกต้อง');
      }
      throw error;
    }
  }

  async findAll(
    queryParams?: GetStudentsQueryDto,
    userScope?: DataScope,
    actor?: AuthenticatedRequestUser,
  ) {
    if (isRestrictedExecutive(actor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ไม่ระบุตัวบุคคล');
    }
    const filters = normalizeStudentListFilters(queryParams);
    const page = filters.page ?? 1;
    const limit = filters.limit ?? DEFAULT_STUDENT_PAGE_SIZE;

    try {
      const { rows, totalCount } = await this.studentsRepository.listStudents(filters, userScope);

      return {
        success: true,
        data: rows.map(
          ({ photo_storage_key: photoStorageKey, photo_updated_at: photoUpdatedAt, ...row }) => ({
            ...row,
            photo_url: photoStorageKey
              ? `/api/students/${encodeURIComponent(row.id)}/photo?v=${encodeMediaVersion(photoUpdatedAt)}`
              : null,
          }),
        ),
        meta: buildPaginationMeta(page, limit, totalCount),
      };
    } catch (error) {
      const resolvedError = error as Error;
      this.logger.error(`findAll error: ${resolvedError.message}`);
      throw error;
    }
  }

  async getFilterOptions(
    query: GetStudentFilterOptionsQueryDto,
    userScope?: DataScope,
    actor?: AuthenticatedRequestUser,
  ) {
    if (isRestrictedExecutive(actor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ไม่ระบุตัวบุคคล');
    }
    try {
      const options = await this.studentsRepository.getStudentFilterOptions(
        {
          schoolId: parseOptionalInteger(query.schoolId),
          province: normalizeOptionalString(query.province),
          district: normalizeOptionalString(query.district),
          subDistrict: normalizeOptionalString(query.subDistrict),
          grade: query.grade && query.grade !== 'ALL' ? query.grade : undefined,
          studentStatusCode: normalizeStudentStatusCode(
            query.student_status_code,
            query.studentStatusCode,
          ),
          enrollmentState: normalizeEnrollmentState(query.enrollmentState),
        },
        userScope,
      );

      return { success: true, data: options };
    } catch (error) {
      const resolvedError = error as Error;
      this.logger.error(`getFilterOptions error: ${resolvedError.message}`);
      throw error;
    }
  }

  private subjectRefFor(studentId: string): string {
    return buildSubjectStudentRef(
      studentId,
      this.piiRuntimeConfig.hashPepper,
      this.piiRuntimeConfig.hashKeyVersion,
    );
  }

  async findOne(id: string, actor?: AuthenticatedRequestUser, userScope?: DataScope) {
    if (isRestrictedExecutive(actor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ไม่ระบุตัวบุคคล');
    }
    try {
      const student = await this.studentsRepository.findStudentById(id, userScope);

      if (!student) {
        throw new NotFoundException(`Student with ID ${id} not found`);
      }

      // Groups this actor revealed within the reveal window stay unmasked so a
      // refresh does not re-prompt or duplicate the audit row.
      const activeGroups =
        typeof actor?.id === 'number'
          ? await this.studentsRepository.listActiveRevealGroups(
              actor.id,
              this.subjectRefFor(id),
              this.piiRuntimeConfig.revealTtlSeconds,
            )
          : [];

      // Attach a ready-to-use home address string so the visit-home form can
      // prefill it (instead of capturing the creator's current GPS), then mask
      // the sensitive groups (national id / passport) before the row leaves the
      // server — they are revealed on demand via revealPii (audited).
      const address = buildStudentTermAddress(student);
      const hasConfirmedLocation =
        student.resolved_home_lat !== null && student.resolved_home_lat !== undefined;
      const approximate = hasConfirmedLocation
        ? null
        : address
          ? await this.geocodeCache.resolve(id, address)
          : null;

      // Contact channels and guardians are person-level. Both are plain contact
      // data — scope-gated by this endpoint, not masked.
      const personUuid = await this.studentsRepository.findPersonUuidByStudentUuid(id);
      const [personContact, guardians] = personUuid
        ? await Promise.all([
            this.studentsRepository.findStudentPersonContact(personUuid),
            this.studentsRepository.listGuardiansByPersonUuid(personUuid),
          ])
        : [null, []];

      const {
        photo_storage_key: photoStorageKey,
        photo_updated_at: photoUpdatedAt,
        ...studentRow
      } = student;
      return maskStudentDetail(
        {
          ...studentRow,
          // Cache-busted by person.updated_at so the internal storage key never
          // leaves the API; the endpoint mints a fresh short-lived signed URL.
          photo_url: photoStorageKey
            ? `/api/students/${encodeURIComponent(id)}/photo?v=${encodeMediaVersion(photoUpdatedAt)}`
            : null,
          contact: personContact
            ? {
                phone: personContact.phone,
                email: personContact.email,
                line_id: personContact.line_id,
              }
            : null,
          guardians,
          address,
          resolved_home_lat: hasConfirmedLocation
            ? student.resolved_home_lat
            : (approximate?.lat ?? null),
          resolved_home_lng: hasConfirmedLocation
            ? student.resolved_home_lng
            : (approximate?.lng ?? null),
          is_approximate_home_location: !hasConfirmedLocation && approximate !== null,
        },
        activeGroups,
      );
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }
      const error = err as Error;
      this.logger.error(`findOne error: ${error.message}`);
      throw err;
    }
  }

  /**
   * Reveal one sensitive PII group for a student and append an immutable record
   * to the access log. Authorization (authenticated staff + `students`
   * permission) is enforced by the controller guards; this method re-applies the
   * same data-scope as findOne and records the reveal before returning values.
   */
  async revealPii(
    id: string,
    actor: AuthenticatedRequestUser | undefined,
    userScope: DataScope | undefined,
    dto: PiiRevealDto,
    meta: PiiRevealRequestMeta,
  ): Promise<{ field_group: string; values: Record<string, unknown> }> {
    try {
      const group = dto.field_group as PiiFieldGroup;
      const subjectRef = this.subjectRefFor(id);

      // If this actor already revealed this group within the window, re-reveal is
      // a no-op log-wise (return the value, no new reason, no duplicate audit row).
      const activeGroups =
        typeof actor?.id === 'number'
          ? await this.studentsRepository.listActiveRevealGroups(
              actor.id,
              subjectRef,
              this.piiRuntimeConfig.revealTtlSeconds,
            )
          : [];
      const withinWindow = activeGroups.includes(group);

      const note = dto.reason_note?.trim() || null;
      if (
        !dto.reason_code ||
        dto.reason_code === 'SELF_ACCESS' ||
        !PII_REASON_CODES.includes(dto.reason_code as PiiReasonCode)
      ) {
        throw new BadRequestException('valid reason_code is required');
      }
      const reasonCode = dto.reason_code as PiiReasonCode;

      if (!withinWindow) {
        if (PII_REASON_REQUIRES_NOTE.includes(reasonCode) && !note) {
          throw new BadRequestException('reason_note is required for this reason code');
        }
        // The note must not itself carry raw PII into the access log — reject any
        // long digit run (e.g. a 13-digit national id) regardless of separators.
        if (note && /\d(?:[\s-]*\d){9,}/u.test(note)) {
          throw new BadRequestException('reason_note must not contain ID or document numbers');
        }
      }

      const student = await this.studentsRepository.findStudentById(id, userScope);
      if (!student) {
        throw new NotFoundException(`Student with ID ${id} not found`);
      }

      const columns = PII_FIELD_GROUPS[group];
      const values: Record<string, unknown> = {};
      for (const column of columns) {
        values[column] =
          column === 'PersonID_Onec'
            ? normalizeNationalIdValue(student[column]) || null
            : (student[column] ?? null);
      }

      if (!withinWindow) {
        await this.studentsRepository.insertPiiAccessEvent({
          actorUserId: resolveAuditActorId(actor),
          actorRoles: actor?.roles ?? [],
          actorKind: 'STAFF',
          subjectStudentRef: subjectRef,
          subjectType: 'STUDENT',
          subjectRef,
          subjectRefKeyVersion: this.piiRuntimeConfig.hashKeyVersion,
          fieldGroup: group,
          reasonCode,
          reasonNote: note,
          purposeLinkId: null,
          requestId: meta.requestId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }

      return { field_group: group, values };
    } catch (err) {
      if (err instanceof NotFoundException || err instanceof BadRequestException) {
        throw err;
      }
      const error = err as Error;
      this.logger.error(`revealPii error: ${error.message}`);
      throw err;
    }
  }

  async findCasesByName(name: string, actor?: AuthenticatedRequestUser, userScope?: DataScope) {
    if (isRestrictedExecutive(actor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ไม่ระบุตัวบุคคล');
    }
    try {
      return await this.studentsRepository.findCasesByStudentName(name, userScope);
    } catch (error) {
      const resolvedError = error as Error;
      this.logger.error(`findCasesByName error: ${resolvedError.message}`);
      throw error;
    }
  }

  async findCasesByStudentId(
    studentUuid: string,
    actor?: AuthenticatedRequestUser,
    userScope?: DataScope,
  ) {
    if (isRestrictedExecutive(actor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ไม่ระบุตัวบุคคล');
    }
    const student = await this.studentsRepository.findStudentById(studentUuid, userScope);
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    return await this.studentsRepository.findCasesByStudentId(studentUuid);
  }

  async findAttendanceByStudentId(
    id: string,
    actor?: AuthenticatedRequestUser,
    userScope?: DataScope,
  ) {
    if (isRestrictedExecutive(actor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ไม่ระบุตัวบุคคล');
    }
    try {
      return await this.studentsRepository.listAttendanceByStudentId(id, userScope);
    } catch (error) {
      const resolvedError = error as Error;
      this.logger.error(`findAttendanceByStudentId error: ${resolvedError.message}`);
      throw error;
    }
  }

  async getStudentProfileSummary(
    id: string,
    actor?: AuthenticatedRequestUser,
    userScope?: DataScope,
  ) {
    if (isRestrictedExecutive(actor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ไม่ระบุตัวบุคคล');
    }
    const student = await this.studentsRepository.findStudentById(id, userScope);
    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const [summary, calendarRows, careRows] = await Promise.all([
      this.studentsRepository.findStudentProfileSummary(id),
      this.studentsRepository.listStudentAttendanceCalendar(id),
      this.studentsRepository.listStudentCareConsiderations(id),
    ]);
    if (!summary) {
      throw new NotFoundException('Student profile summary not found');
    }

    const counts = {
      present: Number(summary.present_count) || 0,
      absent: Number(summary.absent_count) || 0,
      late: Number(summary.late_count) || 0,
      leave: Number(summary.leave_count) || 0,
      total: Number(summary.total_count) || 0,
    };
    const measuredAttendanceTotal = Math.max(0, counts.total - counts.leave);
    const attendanceRatePercent =
      measuredAttendanceTotal > 0
        ? Math.round(((counts.present + counts.late) / measuredAttendanceTotal) * 10_000) / 100
        : null;

    return {
      success: true,
      data: {
        term: {
          academicYear: Number(summary.academic_year),
          semester: Number(summary.semester),
          startsOn: summary.starts_on,
          endsOn: summary.ends_on,
        },
        grades: {
          termGpa: summary.term_gpa === null ? null : Number(summary.term_gpa),
          cumulativeGpax: summary.cumulative_gpax === null ? null : Number(summary.cumulative_gpax),
        },
        careConsiderations: {
          disadvantages: careRows
            .filter((row) => row.care_kind === 'DISADVANTAGE')
            .map((row) => ({
              code: row.code,
              labelTh: row.label_th,
              recordedAt: row.recorded_at,
            })),
          disabilities: careRows
            .filter((row) => row.care_kind === 'DISABILITY')
            .map((row) => ({
              code: row.code,
              labelTh: row.label_th,
              recordedAt: row.recorded_at,
            })),
        },
        attendance: {
          ratePercent: attendanceRatePercent,
          counts,
          days: calendarRows.map((row) => ({
            attendanceCategory: row.attendance_category,
            attendanceCategoryLabel: row.attendance_category_label,
            date: row.date,
            statusCode: Number(row.status_code),
            statusInternalCode: row.status_internal_code,
            statusLabel: row.status_label,
            statusBadgeVariant: row.status_badge_variant,
          })),
        },
      },
    };
  }

  async getStudentSubjectAttendance(
    id: string,
    date: string,
    actor?: AuthenticatedRequestUser,
    userScope?: DataScope,
  ) {
    if (isRestrictedExecutive(actor)) {
      throw new ForbiddenException('บัญชีผู้บริหารดูได้เฉพาะรายงานภาพรวมที่ไม่ระบุตัวบุคคล');
    }
    const student = await this.studentsRepository.findStudentById(id, userScope);
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    const summary = await this.studentsRepository.findStudentProfileSummary(id);
    if (!summary) {
      throw new NotFoundException('Student profile summary not found');
    }
    if (
      (summary.starts_on && date < summary.starts_on) ||
      (summary.ends_on && date > summary.ends_on)
    ) {
      throw new BadRequestException('วันที่เลือกอยู่นอกภาคเรียนของนักเรียน');
    }

    const rows = await this.studentsRepository.listStudentSubjectAttendanceByDate(id, date);
    return {
      success: true,
      data: rows.map((row) => ({
        date: row.date,
        subjectCode: row.subject_code,
        subjectName: row.subject_name,
        statusCode: Number(row.status_code),
        statusInternalCode: row.status_internal_code,
        statusLabel: row.status_label,
        statusBadgeVariant: row.status_badge_variant,
        recordedAt: row.recorded_at,
        checkingStartedAt: row.checking_started_at,
        submittedAt: row.submitted_at,
        recordedBy: row.recorded_by,
      })),
    };
  }

  async update(
    id: string,
    updateStudentDto: UpdateStudentDto,
    actor?: AuthenticatedRequestUser,
    userScope?: DataScope,
  ) {
    const { contact, guardians, ...termFields } = updateStudentDto;
    // The validation pipe materializes every declared DTO key (as undefined),
    // so "provided" must mean value !== undefined, not key-present.
    const hasTermEdit = Object.values(termFields).some((value) => value !== undefined);

    const existing = await this.studentsRepository.findStudentById(id, userScope);
    if (!existing) {
      throw new NotFoundException(`Student with ID ${id} not found`);
    }

    const normalizedGuardians = this.normalizeGuardians(guardians);

    if (hasTermEdit || contact !== undefined || guardians !== undefined) {
      const result = await this.studentsRepository.updateStudent(
        id,
        {
          ...termFields,
          VillageNumber_Onec: cleanPrefixedAddressText('หมู่', termFields.VillageNumber_Onec),
          Street_Onec: cleanPrefixedAddressText('ถนน', termFields.Street_Onec),
          Soi_Onec: cleanPrefixedAddressText('ซอย', termFields.Soi_Onec),
          Trok_Onec: cleanPrefixedAddressText('ตรอก', termFields.Trok_Onec),
        },
        contact,
        normalizedGuardians,
        resolveAuditActorId(actor),
      );
      if ('notFound' in result) {
        throw new NotFoundException(`Student with ID ${id} not found`);
      }
      if ('missingPerson' in result) {
        throw new BadRequestException(
          'นักเรียนคนนี้ยังไม่ได้เชื่อมข้อมูลตัวตน จึงบันทึกข้อมูลติดต่อไม่ได้',
        );
      }
      if ('invalidStatus' in result) {
        throw new BadRequestException('สถานะนักเรียนไม่พร้อมใช้งานหรือเป็นสถานะทางเทคนิค');
      }
      if (
        termFields.student_status_code !== undefined &&
        Number(existing.student_status_code) !== termFields.student_status_code
      ) {
        await this.recalculateStudentRisk(id, 'student-status-update');
      }
    }

    return await this.findOne(id, actor, userScope);
  }

  remove(id: number) {
    return `This action removes a #${id} student`;
  }
}
