import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
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
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { piiConfig } from '../config/pii.config';
import {
  PHASE1_MASKED_GROUPS,
  PII_FIELD_GROUPS,
  PII_REASON_CODES,
  PII_REASON_REQUIRES_NOTE,
  type PiiFieldGroup,
  type PiiReasonCode,
  hasPiiValue,
  maskPiiValue,
} from './pii-fields.config';
import { StudentsRepository } from './students.repository';
import type { StudentDetailRow, StudentListFilters, StudentListRow } from './students.types';
import type { AuthenticatedRequestUser } from '../auth';

/** Metadata captured from the HTTP request for the PII access log. */
export interface PiiRevealRequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
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
      if (active) {
        revealedFields.push(column);
      } else {
        masked[column] = maskPiiValue(masked[column]);
        maskedFields.push(column);
      }
    }
  }

  return { ...masked, masked_fields: maskedFields, revealed_fields: revealedFields };
}

function parseOptionalInteger(value?: string): number | undefined {
  if (!value || value === 'ALL' || value === 'all') {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function normalizeStudentListFilters(queryParams?: GetStudentsQueryDto): StudentListFilters {
  if (!queryParams) {
    return {};
  }

  const searchTerm = queryParams.searchTerm?.trim();

  return {
    grade: queryParams.grade && queryParams.grade !== 'ALL' ? queryParams.grade : undefined,
    room: parseOptionalInteger(queryParams.room),
    schoolId: parseOptionalInteger(queryParams.schoolId),
    searchTerm: searchTerm && searchTerm.length > 0 ? searchTerm : undefined,
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

function isOwnOnlyStudentActor(
  actor?: AuthenticatedRequestUser,
): actor is AuthenticatedRequestUser & { student_uuid: string } {
  return Boolean(
    actor?.roles.includes('STUDENT') &&
    actor.virtual_login &&
    actor.student_uuid &&
    actor.data_scope?.own_only,
  );
}

function mapDetailRowToListRow(student: StudentDetailRow): StudentListRow {
  const firstName =
    typeof student['FirstName_Onec'] === 'string'
      ? student['FirstName_Onec']
      : typeof student['FirstName'] === 'string'
        ? student['FirstName']
        : '';
  const lastName =
    typeof student['LastName_Onec'] === 'string'
      ? student['LastName_Onec']
      : typeof student['LastName'] === 'string'
        ? student['LastName']
        : '';

  const schoolId =
    typeof student['SchoolID_Onec'] === 'number'
      ? student['SchoolID_Onec']
      : typeof student['SchoolID_Onec'] === 'string'
        ? Number.parseInt(student['SchoolID_Onec'], 10)
        : null;

  return {
    id: student.student_uuid ?? '',
    name: `${firstName} ${lastName}`.trim() || 'ไม่ทราบ',
    grade:
      typeof student.grade === 'string' && student.grade.trim().length > 0
        ? student.grade
        : 'ไม่ทราบ',
    room: typeof student.room === 'string' && student.room.trim().length > 0 ? student.room : '-',
    school_name: typeof student.school_name === 'string' ? student.school_name : null,
    school_id: Number.isFinite(schoolId) ? schoolId : null,
  };
}

@Injectable()
export class StudentsService {
  private readonly logger = new Logger(StudentsService.name);

  constructor(
    private readonly studentsRepository: StudentsRepository,
    @Inject(piiConfig.KEY)
    private readonly piiRuntimeConfig: ConfigType<typeof piiConfig>,
  ) {}

  create(createStudentDto: CreateStudentDto) {
    void createStudentDto;
    return 'This action adds a new student';
  }

  async findAll(
    queryParams?: GetStudentsQueryDto,
    userScope?: DataScope,
    actor?: AuthenticatedRequestUser,
  ) {
    const filters = normalizeStudentListFilters(queryParams);
    const page = filters.page ?? 1;
    const limit = filters.limit ?? DEFAULT_STUDENT_PAGE_SIZE;

    try {
      if (isOwnOnlyStudentActor(actor)) {
        const ownStudent = await this.studentsRepository.findStudentById(actor.student_uuid);
        const data = ownStudent ? [mapDetailRowToListRow(ownStudent)] : [];

        return {
          success: true,
          data,
          meta: buildPaginationMeta(page, limit, data.length),
        };
      }

      const { rows, totalCount } = await this.studentsRepository.listStudents(filters, userScope);

      return {
        success: true,
        data: rows,
        meta: buildPaginationMeta(page, limit, totalCount),
      };
    } catch (error) {
      const resolvedError = error as Error;
      this.logger.error(`findAll error: ${resolvedError.message}`);
      throw error;
    }
  }

  async getFilterOptions(query: GetStudentFilterOptionsQueryDto, userScope?: DataScope) {
    try {
      const options = await this.studentsRepository.getStudentFilterOptions(
        {
          schoolId: parseOptionalInteger(query.schoolId),
          grade: query.grade && query.grade !== 'ALL' ? query.grade : undefined,
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
    try {
      this.assertOwnStudentAccess(id, actor);
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
      return maskStudentDetail(
        { ...student, address: buildStudentTermAddress(student) },
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
      this.assertOwnStudentAccess(id, actor);

      const isSelfReveal = isOwnOnlyStudentActor(actor) && actor.student_uuid === id;
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

      let reasonCode: PiiReasonCode;
      // Self-reveal carries no reason context — never persist a client-supplied
      // note for it, so un-guarded input can't reach the immutable audit log.
      const note = isSelfReveal ? null : dto.reason_note?.trim() || null;
      if (isSelfReveal) {
        reasonCode = 'SELF_ACCESS';
      } else {
        if (
          !dto.reason_code ||
          dto.reason_code === 'SELF_ACCESS' ||
          !PII_REASON_CODES.includes(dto.reason_code as PiiReasonCode)
        ) {
          throw new BadRequestException('valid reason_code is required');
        }
        reasonCode = dto.reason_code as PiiReasonCode;
      }

      if (!withinWindow && !isSelfReveal) {
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
        values[column] = student[column] ?? null;
      }

      if (!withinWindow) {
        await this.studentsRepository.insertPiiAccessEvent({
          actorUserId: resolveAuditActorId(actor),
          actorRoles: actor?.roles ?? [],
          actorKind: actor?.virtual_login ? 'GUEST' : 'STAFF',
          subjectStudentRef: subjectRef,
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
      if (
        err instanceof NotFoundException ||
        err instanceof BadRequestException ||
        err instanceof UnauthorizedException
      ) {
        throw err;
      }
      const error = err as Error;
      this.logger.error(`revealPii error: ${error.message}`);
      throw err;
    }
  }

  async findCasesByName(name: string, actor?: AuthenticatedRequestUser) {
    try {
      if (isOwnOnlyStudentActor(actor)) {
        return [];
      }

      return await this.studentsRepository.findCasesByStudentName(name);
    } catch (error) {
      const resolvedError = error as Error;
      this.logger.error(`findCasesByName error: ${resolvedError.message}`);
      throw error;
    }
  }

  async findAttendanceByStudentId(
    id: string,
    actor?: AuthenticatedRequestUser,
    userScope?: DataScope,
  ) {
    try {
      this.assertOwnStudentAccess(id, actor);
      return await this.studentsRepository.listAttendanceByStudentId(id, userScope);
    } catch (error) {
      const resolvedError = error as Error;
      this.logger.error(`findAttendanceByStudentId error: ${resolvedError.message}`);
      throw error;
    }
  }

  update(id: number, updateStudentDto: UpdateStudentDto) {
    void updateStudentDto;
    return `This action updates a #${id} student`;
  }

  remove(id: number) {
    return `This action removes a #${id} student`;
  }

  private assertOwnStudentAccess(requestedUuid: string, actor?: AuthenticatedRequestUser): void {
    if (!isOwnOnlyStudentActor(actor)) {
      return;
    }

    if (!actor.student_uuid) {
      throw new UnauthorizedException('ไม่พบข้อมูลนักเรียนใน session');
    }

    if (actor.student_uuid !== requestedUuid) {
      throw new NotFoundException('Student not found');
    }
  }
}
