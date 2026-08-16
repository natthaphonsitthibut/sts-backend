import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import {
  BadRequestException,
  forwardRef,
  Inject,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import {
  hasAreaDataScope,
  isUnconfiguredDataScope,
  normalizeDataScope,
  type AuthenticatedRequestUser,
  type DataScope,
} from '../auth';
import { hasPermission } from '../auth/permissions.constants';
import { AraIdService } from '../araid/araid.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { generateToken, hashToken, maskEmailAddress } from '../common/utils/helpers';
import { getBangkokDateString, getIsoDayOfWeekFromDateString } from '../common/utils/date.util';
import { encodeMediaVersion } from '../common/utils/media-version.util';
import { AutomationService } from '../automation/automation.service';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { AttendanceWriteService } from '../attendance/attendance-write.service';
import { AttendanceImportService } from '../attendance/attendance-import.service';
import { attendanceStatusFromCode } from '../attendance/attendance-status';
import type { ParsePublicAttendanceImportDto } from '../attendance/dto/attendance-import.dto';
import { StudentsService } from '../students/students.service';
import { SchoolStructureRepository } from '../school-structure/school-structure.repository';
import { StudentObservationsService } from '../student-observations/student-observations.service';
import { TimetableService } from '../timetable/timetable.service';
import { createSqlQueryExecutor } from '../database/sql-query';
import {
  FILE_STORAGE_ADAPTER,
  type FileServeResult,
  type FileStorageAdapter,
} from '../files/storage/file-storage.types';
import { processImageUpload } from '../common/file-upload/visit-photo.util';
import { EmailService } from '../common/email/email.service';
import { MagicSessionStoreService } from '../auth/magic-session-store.service';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import {
  TEACHER_ACCESS_ATTENDANCE_CAPABILITY,
  TEACHER_ACCESS_LINK_PATH,
  TEACHER_ACCESS_DEFAULT_EXPIRY_POLICY,
  TEACHER_ACCESS_DEFAULT_STEP_UP_POLICY,
  TEACHER_ACCESS_NO_ASSIGNMENT_REASON,
  type TeacherAccessExpiryPolicy,
  type TeacherAccessStepUpPolicy,
  type TeacherAccessCapability,
} from './teacher-access.constants';
import type {
  IssueTeacherAccessGrantDto,
  IssueTeacherAccessAttendanceDelegationDto,
  IssuePublicTeacherAccessAttendanceDelegationDto,
  UpdateTeacherAccessAttendanceDelegationDto,
  UpdatePublicTeacherAccessAttendanceDelegationDto,
  IssueTeacherAccessGrantsForTermDto,
  ListTeacherAccessGrantsDto,
  ListTeacherLinkRosterDto,
  SaveTeacherAccessAttendanceDto,
  SaveTeacherAccessAttendanceMarksDto,
  SendTeacherAccessGrantsDto,
} from './dto/teacher-access.dto';
import { OtpStore } from '../common/otp/otp.store';
import { MESSAGING_PROVIDER, type MessagingProvider } from '../common/messaging/messaging.types';
import { TeacherLineService } from '../teacher-line/teacher-line.service';
import { TeacherAccessRepository, type TeacherGrantDeliveryRow } from './teacher-access.repository';
import { AraIdChallengeStore } from '../araid/araid-challenge.store';
import type { AraIdChallengeScope } from '../araid/araid-challenge.store';

/** Every AraID challenge in this service belongs to the teacher-access flow. */
const ARAID_SCOPE: AraIdChallengeScope = 'teacher-access';
import type {
  ActiveTeacherGrantContext,
  TeacherAccessAssignmentRow,
  TeacherAccessGrantDetail,
  TeacherAccessGrantRow,
  TeacherAttendanceDelegationHistoryRow,
  TeacherAttendanceDelegationRow,
} from './teacher-access.types';

/** Namespaces this feature's codes in the shared OTP store. */
function otpKey(grantId: string): string {
  return `teacher-access:${grantId}`;
}

/** Why this teacher cannot be sent their link, or null when they can. */
function undeliverableReason(row: TeacherGrantDeliveryRow): string | null {
  if (row.grant_status !== 'ACTIVE') return 'ยังไม่มีลิงก์ที่ใช้งานอยู่';
  if (!row.token_encrypted) return 'ลิงก์เดิมส่งซ้ำไม่ได้ ต้องออกลิงก์ใหม่';
  if (!row.provider_user_id) return 'ยังไม่ได้ยืนยันบัญชี LINE';
  if (row.friend_state !== 'FRIEND') return 'ยังไม่ได้เพิ่มเพื่อนกับบัญชีทางการ';
  return null;
}

function messageBody(teacherDisplayName: string, accessUrl: string): string {
  return [
    `สวัสดีครับ/ค่ะ คุณครู${teacherDisplayName}`,
    '',
    'นี่คือลิงก์เช็กชื่อของคุณครูสำหรับภาคเรียนนี้',
    accessUrl,
    '',
    'ลิงก์นี้เป็นของคุณครูคนเดียว กรุณาอย่าส่งต่อให้ผู้อื่น',
  ].join('\n');
}

interface ActiveGrantOperationOptions {
  capability?: TeacherAccessCapability;
  assignmentId?: number;
  studentUuid?: string;
  operation: string;
  /** Skip the success-side touch/audit for a read-only preflight that is immediately rechecked. */
  recordSuccessfulUse?: boolean;
  /** OTP-verified session presented by the caller, when the grant demands one. */
  sessionToken?: string;
}

@Injectable()
export class TeacherAccessService {
  private readonly logger = new Logger(TeacherAccessService.name);

  constructor(
    private readonly repository: TeacherAccessRepository,
    private readonly auditLog: AuditLogService,
    private readonly attendanceWriteService: AttendanceWriteService,
    private readonly attendanceImport: AttendanceImportService,
    private readonly automationService: AutomationService,
    private readonly riskProfileService: RiskProfileService,
    private readonly tokenEncryption: TokenEncryptionService,
    private readonly emailService: EmailService,
    private readonly otpStore: OtpStore,
    private readonly magicSessionStore: MagicSessionStoreService,
    private readonly araIdService: AraIdService,
    private readonly araIdChallengeStore: AraIdChallengeStore,
    @Inject(MESSAGING_PROVIDER)
    private readonly messaging: MessagingProvider,
    private readonly teacherMessaging: TeacherLineService,
    @Inject(FILE_STORAGE_ADAPTER)
    private readonly storage: FileStorageAdapter,
    private readonly studentsService: StudentsService,
    private readonly schoolStructure: SchoolStructureRepository,
    private readonly timetableService: TimetableService,
    // Observations depend on teacher-access for the link flows, so the two
    // services reference each other — resolved lazily on this side.
    @Inject(forwardRef(() => StudentObservationsService))
    private readonly studentObservations: StudentObservationsService,
  ) {}

  private resolveIssuerScope(actor: AuthenticatedRequestUser): DataScope {
    if (!hasPermission(actor.roles, actor.permissions, 'manage-teacher-access')) {
      throw new ForbiddenException('ไม่มีสิทธิ์จัดการลิงก์เข้าใช้งานครู');
    }
    const scope = normalizeDataScope(actor.data_scope) ?? {};
    if (
      scope.own_only === true ||
      isUnconfiguredDataScope(scope) ||
      (scope.grade_levels?.length ?? 0) > 0 ||
      (scope.room_ids?.length ?? 0) > 0
    ) {
      throw new ForbiddenException('ขอบเขตบัญชีไม่อนุญาตให้ออกลิงก์ระดับโรงเรียน');
    }
    if (scope.global !== true && !hasAreaDataScope(scope)) {
      throw new ForbiddenException('ไม่พบขอบเขตโรงเรียนที่ใช้งานได้');
    }
    return scope;
  }

  private async assertSchoolAccess(
    schoolId: number,
    actor: AuthenticatedRequestUser,
  ): Promise<void> {
    const allowed = await this.repository.isSchoolInScope(schoolId, this.resolveIssuerScope(actor));
    if (!allowed) throw new NotFoundException('ไม่พบโรงเรียนในขอบเขตของคุณ');
  }

  /**
   * The link-management screen owns a teacher's own term link. A delegation
   * grant (ATTENDANCE_ONLY) belongs to the class it stands in for and is closed
   * from the teacher's check-in page, so copying or rotating one from here would
   * hand out a one-day stand-in link as if it were the teacher's login link.
   */
  private assertTermLinkGrant(row: TeacherAccessGrantRow): void {
    if (row.access_scope === 'ATTENDANCE_ONLY') {
      throw new ConflictException(
        'ลิงก์นี้เป็นลิงก์มอบหมายการเช็กชื่อ ไม่ใช่ลิงก์ประจำภาคเรียนของครู',
      );
    }
  }

  private grantStatus(row: TeacherAccessGrantRow): 'ACTIVE' | 'REVOKED' | 'EXPIRED' | 'SUSPENDED' {
    if (row.revoked_at) return 'REVOKED';
    if (new Date(row.expires_at).getTime() <= Date.now()) return 'EXPIRED';
    if (
      row.teacher_status !== 'ACTIVE' ||
      row.membership_status !== 'ACTIVE' ||
      row.membership_deleted_at ||
      row.school_status !== 'ACTIVE' ||
      row.term_status !== 'ACTIVE' ||
      row.term_deleted_at
    ) {
      return 'SUSPENDED';
    }
    return 'ACTIVE';
  }

  private toGrant(row: TeacherAccessGrantRow) {
    return {
      id: row.id,
      teacherMembershipId: row.teacher_membership_id,
      teacherUserId: row.teacher_user_id,
      teacherUsername: row.teacher_username,
      teacherDisplayName: row.teacher_display_name,
      schoolId: row.school_id,
      schoolName: row.school_name,
      schoolTermId: row.school_term_id,
      academicYear: row.academic_year,
      semester: row.semester,
      status: this.grantStatus(row),
      capabilities: row.capabilities,
      accessScope: row.access_scope === 'ATTENDANCE_ONLY' ? 'ATTENDANCE_ONLY' : 'FULL',
      assignmentCount: Number(row.assignment_count),
      stepUpPolicy: row.step_up_policy,
      issuerName: row.issuer_name,
      issuedAt: new Date(row.issued_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
      revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
      revocationReason: row.revocation_reason,
      rotatedAt: row.rotated_at ? new Date(row.rotated_at).toISOString() : null,
      rotationCount: Number(row.rotation_count),
    };
  }

  private toAssignment(row: TeacherAccessAssignmentRow, capabilities: TeacherAccessCapability[]) {
    const allowedActions: TeacherAccessCapability[] = [];
    const attendance = this.attendanceCapability(row.assignment_kind);
    if (capabilities.includes(attendance)) {
      allowedActions.push(attendance);
    }
    if (row.assignment_kind === 'SUBJECT' && capabilities.includes('TEACHER_OBSERVATION')) {
      allowedActions.push('TEACHER_OBSERVATION');
    }
    return {
      id: row.assignment_id,
      classroomId: row.classroom_id,
      gradeLevelId: row.grade_level_id,
      gradeLabel: row.grade_label,
      roomCode: row.room_code,
      roomName: row.room_name,
      cardCoverColor: row.card_cover_color,
      hasCoverImage: Boolean(row.has_cover_image),
      coverImagePositionX: Number(row.cover_image_position_x),
      coverImagePositionY: Number(row.cover_image_position_y),
      coverImageScale: Number(row.cover_image_scale),
      assignmentKind: row.assignment_kind,
      subjectId: row.subject_id,
      subjectCode: row.subject_code,
      subjectName: row.subject_name,
      effectiveOn: row.effective_on,
      effectiveUntil: row.effective_until,
      allowedActions,
    };
  }

  private toAttendanceDelegation(row: TeacherAttendanceDelegationRow, baseUrl: string) {
    if (!row.token_encrypted) throw new ConflictException('ลิงก์มอบหมายนี้ไม่สามารถแชร์ซ้ำได้');
    let rawToken: string;
    try {
      rawToken = this.tokenEncryption.decrypt(row.token_encrypted);
    } catch {
      throw new ConflictException('ลิงก์มอบหมายนี้ไม่สามารถแชร์ซ้ำได้');
    }
    return {
      grantId: row.grant_id,
      teacherMembershipId: Number(row.teacher_membership_id),
      teacherDisplayName: row.teacher_display_name,
      assignmentId: Number(row.assignment_id),
      assignmentKind: row.assignment_kind,
      subjectName: row.subject_name,
      timetableSlotId: row.timetable_slot_id ? Number(row.timetable_slot_id) : null,
      period: row.timetable_slot_period,
      attendanceDate: row.attendance_date,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      accessUrl: this.buildAccessUrl(baseUrl, rawToken),
    };
  }

  private buildAccessUrl(baseUrl: string, token: string): string {
    return `${baseUrl.replace(/\/$/, '')}${TEACHER_ACCESS_LINK_PATH}#token=${encodeURIComponent(token)}`;
  }

  private resolveTermExpiry(endsOn: string): Date {
    return new Date(`${endsOn}T23:59:59.999+07:00`);
  }

  private resolveDefaultExpiry(
    policy: TeacherAccessExpiryPolicy,
    termExpiry: Date,
    assignments: TeacherAccessAssignmentRow[],
  ): Date {
    if (policy === 'TERM_END') return termExpiry;
    const assignmentExpiries = assignments
      .map((assignment) => assignment.effective_until)
      .filter((value): value is string => Boolean(value))
      .map((value) => this.resolveTermExpiry(value));
    if (assignmentExpiries.length === 0) return termExpiry;
    return new Date(
      Math.min(termExpiry.getTime(), ...assignmentExpiries.map((date) => date.getTime())),
    );
  }

  /** Attendance capability implied by an assignment kind. */
  private attendanceCapability(
    kind: TeacherAccessAssignmentRow['assignment_kind'],
  ): TeacherAccessCapability {
    return TEACHER_ACCESS_ATTENDANCE_CAPABILITY[kind];
  }

  /**
   * A teacher link covers everything that teacher is assigned this term — the
   * admin screen does not pick capabilities per link any more, so they are
   * derived from the assignments themselves.
   */
  private capabilitiesForAssignments(
    assignments: TeacherAccessAssignmentRow[],
  ): TeacherAccessCapability[] {
    const capabilities = new Set<TeacherAccessCapability>();
    for (const assignment of assignments) {
      capabilities.add(this.attendanceCapability(assignment.assignment_kind));
      if (assignment.assignment_kind === 'SUBJECT') {
        capabilities.add('TEACHER_OBSERVATION');
      }
    }
    return [...capabilities].sort();
  }

  private assignmentActiveToday(row: TeacherAccessAssignmentRow): boolean {
    const today = getBangkokDateString();
    return (
      row.assignment_status === 'ACTIVE' &&
      row.classroom_status === 'ACTIVE' &&
      (!row.effective_on || row.effective_on <= today) &&
      (!row.effective_until || row.effective_until >= today)
    );
  }

  /** Term row every issue path validates before writing a grant. */
  private async loadIssuableTerm(
    schoolTermId: number,
    actor: AuthenticatedRequestUser,
    queryRunner: QueryRunner,
  ) {
    const term = await this.repository.findTermForIssue(schoolTermId, queryRunner);
    if (!term) throw new NotFoundException('ไม่พบภาคเรียน');
    await this.assertSchoolAccess(term.school_id, actor);
    if (term.status !== 'ACTIVE') {
      throw new ConflictException('ออกลิงก์ได้เฉพาะภาคเรียนที่เปิดใช้งาน');
    }
    if (!term.ends_on) {
      throw new ConflictException('ภาคเรียนต้องกำหนดวันสิ้นสุดก่อนออกลิงก์');
    }
    return { ...term, ends_on: term.ends_on };
  }

  /**
   * Issues one grant. Capabilities and assignments are no longer chosen by the
   * admin: a teacher link simply covers every class that teacher currently
   * teaches in the term, and expires with the term.
   */
  private async createGrantForMembership(
    input: {
      teacherMembershipId: number;
      schoolId: number;
      schoolTermId: number;
      termExpiry: Date;
      expiresAt?: string;
      assignments: TeacherAccessAssignmentRow[];
      expiryPolicy: TeacherAccessExpiryPolicy;
      stepUpPolicy: TeacherAccessStepUpPolicy;
      actor: AuthenticatedRequestUser;
      actorId: number;
    },
    queryRunner: QueryRunner,
  ): Promise<{ detail: TeacherAccessGrantDetail; rawToken: string }> {
    const membership = await this.repository.findMembershipForIssue(
      input.teacherMembershipId,
      queryRunner,
    );
    if (
      !membership ||
      membership.membership_status !== 'ACTIVE' ||
      membership.teacher_status !== 'ACTIVE'
    ) {
      throw new BadRequestException('ครูไม่ได้อยู่ในรายชื่อครูที่เปิดใช้งาน');
    }
    if (membership.school_id !== input.schoolId) {
      throw new BadRequestException('ครูและภาคเรียนต้องอยู่โรงเรียนเดียวกัน');
    }
    if (input.assignments.length === 0) {
      throw new BadRequestException(`ครูคนนี้${TEACHER_ACCESS_NO_ASSIGNMENT_REASON}`);
    }

    const capabilities = this.capabilitiesForAssignments(input.assignments);
    const assignmentIds = input.assignments.map((assignment) => Number(assignment.assignment_id));
    const defaultExpiry = this.resolveDefaultExpiry(
      input.expiryPolicy,
      input.termExpiry,
      input.assignments,
    );
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : defaultExpiry;
    if (expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('วันหมดอายุต้องอยู่ในอนาคต');
    }
    if (expiresAt.getTime() > input.termExpiry.getTime()) {
      throw new BadRequestException('ลิงก์ต้องไม่หมดอายุหลังสิ้นสุดภาคเรียน');
    }

    const rawToken = generateToken();
    const grantId = await this.repository.createGrant(
      {
        teacherMembershipId: input.teacherMembershipId,
        schoolId: input.schoolId,
        schoolTermId: input.schoolTermId,
        tokenHash: hashToken(rawToken),
        tokenEncrypted: this.tokenEncryption.encrypt(rawToken),
        stepUpPolicy: input.stepUpPolicy,
        issuedBy: input.actorId,
        expiresAt,
        capabilities,
        assignmentIds,
      },
      queryRunner,
    );
    const detail = await this.repository.getGrantDetail(grantId, queryRunner);
    if (!detail) throw new ConflictException('สร้างลิงก์ไม่สำเร็จ');
    await this.auditLog.recordAtomic(
      {
        actorUserId: input.actorId,
        actorLabel: input.actor.username,
        action: 'TEACHER_ACCESS_GRANT_ISSUE',
        targetType: 'teacher_access_grants',
        targetId: grantId,
        metadata: {
          schoolId: input.schoolId,
          schoolName: detail.grant.school_name,
          teacherName: detail.grant.teacher_display_name,
          teacherMembershipId: input.teacherMembershipId,
          schoolTermId: input.schoolTermId,
          assignmentIds,
          capabilities,
          stepUpPolicy: input.stepUpPolicy,
          expiresAt: expiresAt.toISOString(),
        },
        ip: null,
      },
      queryRunner,
    );
    return { detail, rawToken };
  }

  private loadIssuePolicies() {
    return {
      expiryPolicy: TEACHER_ACCESS_DEFAULT_EXPIRY_POLICY,
      stepUpPolicy: TEACHER_ACCESS_DEFAULT_STEP_UP_POLICY,
    };
  }

  async issueGrant(
    dto: IssueTeacherAccessGrantDto,
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้ออกลิงก์');

    const result = await this.repository.withTransaction(async (queryRunner) => {
      const term = await this.loadIssuableTerm(dto.schoolTermId, actor, queryRunner);
      const policies = this.loadIssuePolicies();
      const assignments = await this.repository.listAssignmentOptions(
        {
          schoolId: term.school_id,
          schoolTermId: dto.schoolTermId,
          teacherMembershipIds: [dto.teacherMembershipId],
          onDate: getBangkokDateString(),
        },
        queryRunner,
      );
      return await this.createGrantForMembership(
        {
          teacherMembershipId: dto.teacherMembershipId,
          schoolId: term.school_id,
          schoolTermId: dto.schoolTermId,
          termExpiry: this.resolveTermExpiry(term.ends_on),
          expiresAt: dto.expiresAt,
          assignments,
          ...policies,
          actor,
          actorId,
        },
        queryRunner,
      );
    });

    return {
      data: {
        ...this.toGrant(result.detail.grant),
        assignments: result.detail.assignments.map((row) =>
          this.toAssignment(row, result.detail.capabilities),
        ),
        accessUrl: this.buildAccessUrl(baseUrl, result.rawToken),
      },
    };
  }

  /**
   * Bulk action behind "สร้างลิงก์เช็กชื่อ": issues one link per active teacher
   * who teaches this term and has no usable link yet. Teachers whose data blocks
   * an issue (no assignment, inactive membership) are reported as skipped rather
   * than failing the whole batch.
   */
  /**
   * Explains every picked membership the issue query left out, so the admin who
   * ticked those rows sees the reason instead of a bare count.
   */
  private async explainUnissuablePicks(
    input: {
      schoolId: number;
      schoolTermId: number;
      onDate: string;
      picked: number[];
      pending: number[];
    },
    queryRunner: QueryRunner,
  ): Promise<Array<{ teacherMembershipId: number; reason: string }>> {
    const pending = new Set(input.pending);
    const leftOut = [...new Set(input.picked)].filter((id) => !pending.has(id));
    if (leftOut.length === 0) return [];

    const rows = await this.repository.describeMembershipsForGrant(
      {
        schoolId: input.schoolId,
        schoolTermId: input.schoolTermId,
        onDate: input.onDate,
        teacherMembershipIds: leftOut,
      },
      queryRunner,
    );
    const byMembership = new Map(rows.map((row) => [Number(row.teacher_membership_id), row]));
    return leftOut.map((teacherMembershipId) => {
      const row = byMembership.get(teacherMembershipId);
      if (!row) return { teacherMembershipId, reason: 'ครูไม่ได้อยู่ในโรงเรียนของภาคเรียนนี้' };
      if (row.has_active_grant) {
        return { teacherMembershipId, reason: 'มีลิงก์ที่ใช้งานได้อยู่แล้ว' };
      }
      if (!row.is_active) {
        return { teacherMembershipId, reason: 'ครูไม่ได้อยู่ในรายชื่อครูที่เปิดใช้งาน' };
      }
      if (Number(row.assignment_count) === 0) {
        return { teacherMembershipId, reason: TEACHER_ACCESS_NO_ASSIGNMENT_REASON };
      }
      return { teacherMembershipId, reason: 'สร้างลิงก์ให้ครูคนนี้ไม่ได้ในขณะนี้' };
    });
  }

  /**
   * Delivers each teacher their OWN link over the chat provider.
   *
   * Only teachers who verified their account AND still have it added can be
   * reached, so everyone else is reported with a reason rather than silently
   * dropped — an admin pressing "send to everyone" needs to know who was missed.
   * A refusal from the provider is written back as the friendship state, because
   * that answer is fresher than whatever the webhook last told us.
   */
  async sendGrantsOverMessaging(
    dto: SendTeacherAccessGrantsDto,
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    if (!this.messaging.isEnabled()) {
      throw new ServiceUnavailableException('ระบบส่งข้อความ LINE ยังไม่เปิดใช้งาน');
    }
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้ที่ส่งลิงก์');

    const term = await this.repository.withTransaction(
      async (queryRunner) => await this.loadIssuableTerm(dto.schoolTermId, actor, queryRunner),
    );
    const rows = await this.repository.listGrantsForDelivery({
      schoolId: term.school_id,
      schoolTermId: dto.schoolTermId,
      teacherMembershipIds: dto.teacherMembershipIds,
    });

    const skipped: Array<{ teacherMembershipId: number; reason: string }> = [];
    if (dto.teacherMembershipIds) {
      const returnedIds = new Set(rows.map((row) => Number(row.teacher_membership_id)));
      for (const teacherMembershipId of new Set(dto.teacherMembershipIds)) {
        if (!returnedIds.has(teacherMembershipId)) {
          skipped.push({
            teacherMembershipId,
            reason: 'ครูไม่ได้อยู่ในโรงเรียนของภาคเรียนนี้',
          });
        }
      }
    }
    const deliverable: Array<{ row: TeacherGrantDeliveryRow; accessUrl: string }> = [];
    for (const row of rows) {
      const reason = undeliverableReason(row);
      if (reason) {
        skipped.push({ teacherMembershipId: Number(row.teacher_membership_id), reason });
        continue;
      }
      deliverable.push({
        row,
        accessUrl: this.buildAccessUrl(
          baseUrl,
          this.tokenEncryption.decrypt(row.token_encrypted as string),
        ),
      });
    }

    const results = await this.messaging.sendMessages(
      deliverable.map(({ row, accessUrl }) => ({
        providerUserId: row.provider_user_id as string,
        text: messageBody(row.teacher_display_name, accessUrl),
      })),
      `teacher-access-${dto.schoolTermId}-${dto.deliveryRequestId}`,
    );

    let sent = 0;
    for (const [index, result] of results.entries()) {
      const { row } = deliverable[index];
      if (result.delivered) {
        sent += 1;
      } else {
        skipped.push({
          teacherMembershipId: Number(row.teacher_membership_id),
          reason: result.errorMessage ?? 'ส่งข้อความไม่สำเร็จ',
        });
        await this.teacherMessaging.markUnreachable(row.provider_user_id as string);
      }
      try {
        await this.auditLog.record({
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'TEACHER_ACCESS_GRANT_SEND',
          targetType: 'teacher_access_grants',
          targetId: row.grant_id,
          metadata: {
            teacherName: row.teacher_display_name,
            delivered: result.delivered,
            provider: 'LINE',
            deliveryRequestId: dto.deliveryRequestId,
          },
          ip: null,
        });
      } catch (error) {
        // Delivery has already happened. Returning a server error here invites
        // an operator retry and a duplicate message, so retain the delivery
        // result and surface the audit outage through structured server logs.
        this.logger.error(
          `Could not audit LINE grant delivery ${row.grant_id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return { data: { sent, skipped } };
  }

  async issueGrantsForTerm(
    dto: IssueTeacherAccessGrantsForTermDto,
    actor: AuthenticatedRequestUser,
  ) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้ออกลิงก์');
    const onDate = getBangkokDateString();

    return await this.repository.withTransaction(async (queryRunner) => {
      const term = await this.loadIssuableTerm(dto.schoolTermId, actor, queryRunner);
      const policies = this.loadIssuePolicies();
      const pending = await this.repository.listMembershipsNeedingGrant(
        {
          schoolId: term.school_id,
          schoolTermId: dto.schoolTermId,
          onDate,
          teacherMembershipIds: dto.teacherMembershipIds,
        },
        queryRunner,
      );
      const membershipIds = pending.map((row) => Number(row.teacher_membership_id));
      const assignments = await this.repository.listAssignmentOptions(
        {
          schoolId: term.school_id,
          schoolTermId: dto.schoolTermId,
          teacherMembershipIds: membershipIds,
          onDate,
        },
        queryRunner,
      );
      const byMembership = new Map<number, TeacherAccessAssignmentRow[]>();
      for (const assignment of assignments) {
        const key = Number(assignment.teacher_membership_id);
        byMembership.set(key, [...(byMembership.get(key) ?? []), assignment]);
      }

      const termExpiry = this.resolveTermExpiry(term.ends_on);
      let issued = 0;
      const skipped: Array<{ teacherMembershipId: number; reason: string }> = [];
      if (dto.teacherMembershipIds) {
        skipped.push(
          ...(await this.explainUnissuablePicks(
            {
              schoolId: term.school_id,
              schoolTermId: dto.schoolTermId,
              onDate,
              picked: dto.teacherMembershipIds,
              pending: membershipIds,
            },
            queryRunner,
          )),
        );
      }
      for (const teacherMembershipId of membershipIds) {
        try {
          await this.createGrantForMembership(
            {
              teacherMembershipId,
              schoolId: term.school_id,
              schoolTermId: dto.schoolTermId,
              termExpiry,
              assignments: byMembership.get(teacherMembershipId) ?? [],
              ...policies,
              actor,
              actorId,
            },
            queryRunner,
          );
          issued += 1;
        } catch (error) {
          if (error instanceof BadRequestException) {
            skipped.push({ teacherMembershipId, reason: error.message });
            continue;
          }
          throw error;
        }
      }
      return { data: { issued, skipped } };
    });
  }

  /**
   * Re-reads the link of an existing grant. Only possible for grants issued
   * after `token_encrypted` existed — older ones must be rotated instead.
   */
  async getGrantLink(grantId: string, actor: AuthenticatedRequestUser, baseUrl: string) {
    const grant = await this.repository.findGrantById(grantId);
    if (!grant) throw new NotFoundException('ไม่พบลิงก์เข้าใช้งานครู');
    await this.assertSchoolAccess(grant.school_id, actor);
    this.assertTermLinkGrant(grant);
    if (this.grantStatus(grant) !== 'ACTIVE') {
      throw new ConflictException('คัดลอกได้เฉพาะลิงก์ที่ใช้งานอยู่');
    }
    if (!grant.token_encrypted) {
      throw new ConflictException('ลิงก์นี้ออกก่อนระบบเก็บลิงก์แบบเรียกดูซ้ำได้ กรุณาออกลิงก์ใหม่');
    }
    const actorId = resolveAuditActorId(actor);
    await this.auditLog.record({
      actorUserId: actorId,
      actorLabel: actor.username,
      action: 'TEACHER_ACCESS_GRANT_REVEAL',
      targetType: 'teacher_access_grants',
      targetId: grant.id,
      metadata: {
        schoolId: grant.school_id,
        teacherName: grant.teacher_display_name,
      },
      ip: null,
    });
    return {
      data: {
        grantId: grant.id,
        accessUrl: this.buildAccessUrl(
          baseUrl,
          this.tokenEncryption.decrypt(grant.token_encrypted),
        ),
      },
    };
  }

  /** Teacher roster for the link-management screen (one row per teacher). */
  async listTeacherLinkRoster(query: ListTeacherLinkRosterDto, actor: AuthenticatedRequestUser) {
    await this.assertSchoolAccess(query.schoolId, actor);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const rows = await this.repository.listTeacherLinkRoster({
      schoolId: query.schoolId,
      schoolTermId: query.schoolTermId,
      onDate: getBangkokDateString(),
      search: query.search,
      lineStatus: query.lineStatus,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      page,
      limit,
    });
    return {
      data: rows.map((row) => ({
        teacherMembershipId: row.teacher_membership_id,
        teacherId: row.teacher_id,
        teacherDisplayName: row.teacher_display_name,
        photoUrl: row.teacher_photo_storage_key
          ? `/api/teacher-access-grants/teacher-memberships/${row.teacher_membership_id}/photo?v=${encodeMediaVersion(row.teacher_photo_updated_at)}`
          : null,
        hasEmail: Boolean(row.teacher_email),
        assignmentCount: Number(row.assignment_count),
        grantId: row.grant_id,
        linkStatus: row.grant_status ?? 'NOT_CREATED',
        canCopyLink: row.grant_status === 'ACTIVE' && row.has_token_cipher === true,
        issuedAt: row.issued_at ? new Date(row.issued_at).toISOString() : null,
        expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
        lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
        // Verified but unreachable is its own state: the teacher proved who they
        // are, then removed or blocked the official account, so a send would fail.
        lineStatus: !row.line_verified
          ? ('NOT_VERIFIED' as const)
          : row.line_friend_state === 'FRIEND'
            ? ('VERIFIED' as const)
            : ('VERIFIED_NOT_REACHABLE' as const),
        lineInvitationId: row.line_invitation_id,
        lineInvitationStatus: row.line_invitation_status ?? 'NOT_ISSUED',
        lineInvitationExpiresAt: row.line_invitation_expires_at
          ? new Date(row.line_invitation_expires_at).toISOString()
          : null,
      })),
      meta: buildPaginationMeta(page, limit, Number(rows[0]?.total_count ?? 0)),
    };
  }

  async resolveTeacherRosterPhoto(
    teacherMembershipId: number,
    actor: AuthenticatedRequestUser,
  ): Promise<FileServeResult> {
    const photo = await this.repository.findTeacherMembershipPhoto(teacherMembershipId);
    if (!photo?.photo_storage_key) throw new NotFoundException('ไม่พบรูปประจำตัวครู');
    await this.assertSchoolAccess(photo.school_id, actor);
    const result = await this.storage.resolve(photo.photo_storage_key);
    if (!result) throw new NotFoundException('ไม่พบรูปประจำตัวครู');
    return result;
  }

  async unlinkTeacherLineAccount(teacherMembershipId: number, actor: AuthenticatedRequestUser) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้ที่ปลดการเชื่อมต่อ LINE');

    return await this.repository.withTransaction(async (queryRunner) => {
      const membership = await this.repository.findMembershipForIssue(
        teacherMembershipId,
        queryRunner,
      );
      if (
        !membership ||
        membership.membership_status !== 'ACTIVE' ||
        membership.teacher_status !== 'ACTIVE'
      ) {
        throw new NotFoundException('ไม่พบครูที่เปิดใช้งานในโรงเรียนนี้');
      }
      await this.assertSchoolAccess(membership.school_id, actor);

      const unlinked = await this.teacherMessaging.unlinkActiveAccountForTeacher(
        membership.teacher_id,
        'UNLINKED_BY_SCHOOL_ADMIN',
        actorId,
        queryRunner,
      );
      if (!unlinked) {
        throw new ConflictException('ครูคนนี้ยังไม่ได้ยืนยันบัญชี LINE');
      }

      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'TEACHER_MESSAGING_UNLINK',
          targetType: 'teachers',
          targetId: membership.teacher_id,
          metadata: {
            provider: 'LINE',
            schoolId: membership.school_id,
            teacherMembershipId: membership.id,
            teacherName: membership.teacher_display_name,
            reason: 'UNLINKED_BY_SCHOOL_ADMIN',
          },
          ip: null,
        },
        queryRunner,
      );
      return { data: { success: true } };
    });
  }

  async issueTeacherLineInvitation(
    teacherMembershipId: number,
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้ออกลิงก์ยืนยัน LINE');
    return await this.repository.withTransaction(async (queryRunner) => {
      const membership = await this.repository.findMembershipForIssue(
        teacherMembershipId,
        queryRunner,
      );
      if (
        !membership ||
        membership.membership_status !== 'ACTIVE' ||
        membership.teacher_status !== 'ACTIVE'
      ) {
        throw new NotFoundException('ไม่พบครูที่เปิดใช้งานในโรงเรียนนี้');
      }
      await this.assertSchoolAccess(membership.school_id, actor);
      if (!membership.teacher_email?.trim()) {
        throw new ConflictException('ครูคนนี้ยังไม่มีอีเมลสำหรับรับรหัสยืนยัน');
      }
      const invitation = await this.teacherMessaging.issueInvitation(
        {
          teacherMembershipId,
          teacherId: membership.teacher_id,
          issuedBy: actorId,
          baseUrl,
        },
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'TEACHER_LINE_INVITATION_ISSUE',
          targetType: 'teacher_line_invitations',
          targetId: invitation.id,
          metadata: {
            schoolId: membership.school_id,
            teacherMembershipId,
            expiresAt: invitation.expiresAt,
          },
          ip: null,
        },
        queryRunner,
      );
      return { success: true, data: invitation };
    });
  }

  async issueTeacherLineGroupInvitation(
    input: { schoolId: number; startsAt: string; expiresAt: string },
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้ออกลิงก์ยืนยัน LINE');
    await this.assertSchoolAccess(input.schoolId, actor);
    const schoolName = await this.repository.findActiveSchoolName(input.schoolId);
    if (!schoolName) throw new NotFoundException('ไม่พบโรงเรียนในขอบเขตของคุณ');
    const result = await this.teacherMessaging.issueGroupInvitation({
      schoolId: input.schoolId,
      schoolName,
      issuedBy: actorId,
      startsAt: new Date(input.startsAt),
      expiresAt: new Date(input.expiresAt),
      baseUrl,
    });
    await this.auditLog.record({
      actorUserId: actorId,
      actorLabel: actor.username,
      action: 'TEACHER_LINE_INVITATION_ISSUE',
      targetType: 'teacher_line_group_invitation',
      metadata: {
        invitationMode: 'GROUP',
        schoolId: input.schoolId,
        startsAt: result.startsAt,
        expiresAt: result.expiresAt,
      },
      ip: null,
    });
    return { success: true, data: result };
  }

  async getTeacherLineGroupInvitation(
    schoolId: number,
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    await this.assertSchoolAccess(schoolId, actor);
    return {
      success: true,
      data: await this.teacherMessaging.getActiveGroupInvitation(schoolId, baseUrl),
    };
  }

  async updateTeacherLineGroupInvitation(
    invitationId: string,
    input: { schoolId: number; startsAt: string; expiresAt: string },
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้แก้ไขลิงก์ยืนยัน LINE');
    await this.assertSchoolAccess(input.schoolId, actor);
    const result = await this.teacherMessaging.updateGroupInvitation({
      id: invitationId,
      schoolId: input.schoolId,
      startsAt: new Date(input.startsAt),
      expiresAt: new Date(input.expiresAt),
      baseUrl,
    });
    await this.auditLog.record({
      actorUserId: actorId,
      actorLabel: actor.username,
      action: 'TEACHER_LINE_INVITATION_ISSUE',
      targetType: 'teacher_line_group_invitation',
      targetId: invitationId,
      metadata: {
        invitationMode: 'GROUP_UPDATE',
        schoolId: input.schoolId,
        startsAt: result.startsAt,
        expiresAt: result.expiresAt,
      },
      ip: null,
    });
    return { success: true, data: result };
  }

  async revokeTeacherLineGroupInvitation(
    invitationId: string,
    schoolId: number,
    actor: AuthenticatedRequestUser,
  ) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้ปิดลิงก์ยืนยัน LINE');
    await this.assertSchoolAccess(schoolId, actor);
    const revoked = await this.teacherMessaging.revokeGroupInvitation(
      invitationId,
      schoolId,
      actorId,
    );
    if (!revoked) throw new GoneException('ลิงก์ยืนยัน LINE ถูกปิดหรือหมดอายุแล้ว');
    await this.auditLog.record({
      actorUserId: actorId,
      actorLabel: actor.username,
      action: 'TEACHER_LINE_INVITATION_REVOKE',
      targetType: 'teacher_line_group_invitation',
      targetId: invitationId,
      metadata: { invitationMode: 'GROUP', schoolId, reason: 'REVOKED_BY_ADMIN' },
      ip: null,
    });
    return { success: true, data: { revoked: true } };
  }

  async revokeTeacherLineInvitation(teacherMembershipId: number, actor: AuthenticatedRequestUser) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้ยกเลิกลิงก์ยืนยัน LINE');
    return await this.repository.withTransaction(async (queryRunner) => {
      const membership = await this.repository.findMembershipForIssue(
        teacherMembershipId,
        queryRunner,
      );
      if (!membership) throw new NotFoundException('ไม่พบครูในโรงเรียนนี้');
      await this.assertSchoolAccess(membership.school_id, actor);
      const revoked = await this.teacherMessaging.revokeInvitation(
        teacherMembershipId,
        actorId,
        queryRunner,
      );
      if (!revoked) throw new ConflictException('ไม่มีลิงก์ยืนยัน LINE ที่ยังใช้งานได้');
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'TEACHER_LINE_INVITATION_REVOKE',
          targetType: 'teachers',
          targetId: membership.teacher_id,
          metadata: { schoolId: membership.school_id, teacherMembershipId },
          ip: null,
        },
        queryRunner,
      );
      return { success: true };
    });
  }

  async listGrants(query: ListTeacherAccessGrantsDto, actor: AuthenticatedRequestUser) {
    await this.assertSchoolAccess(query.schoolId, actor);
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const rows = await this.repository.listGrants({
      schoolId: query.schoolId,
      schoolTermId: query.schoolTermId,
      status: query.status,
      page,
      limit,
    });
    const totalCount = Number(rows[0]?.total_count ?? 0);
    return {
      data: rows.map((row) => this.toGrant(row)),
      meta: buildPaginationMeta(page, limit, totalCount),
    };
  }

  async listAssignmentOptions(
    input: { schoolId: number; schoolTermId: number; teacherMembershipId: number },
    actor: AuthenticatedRequestUser,
  ) {
    await this.assertSchoolAccess(input.schoolId, actor);
    const rows = await this.repository.listAssignmentOptions({
      schoolId: input.schoolId,
      schoolTermId: input.schoolTermId,
      teacherMembershipIds: [input.teacherMembershipId],
      onDate: getBangkokDateString(),
    });
    return {
      data: rows.map((row) => this.toAssignment(row, this.capabilitiesForAssignments(rows))),
    };
  }

  /** Share link included only while the delegation can still be opened. */
  private toDelegationHistoryEntry(row: TeacherAttendanceDelegationHistoryRow, baseUrl: string) {
    let accessUrl: string | null = null;
    if (row.token_encrypted && row.delegation_status === 'PENDING') {
      try {
        accessUrl = this.buildAccessUrl(baseUrl, this.tokenEncryption.decrypt(row.token_encrypted));
      } catch {
        accessUrl = null;
      }
    }
    return {
      grantId: row.grant_id,
      assignmentId: Number(row.assignment_id),
      teacherMembershipId: Number(row.teacher_membership_id),
      issuedByName: row.issued_by_name,
      teacherDisplayName: row.teacher_display_name,
      subjectName: row.subject_name,
      period: row.timetable_slot_period,
      attendanceDate: row.attendance_date,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: new Date(row.ends_at).toISOString(),
      status: row.delegation_status,
      accessUrl,
    };
  }

  async listAttendanceDelegationOptions(
    input: { schoolId: number; schoolTermId: number; classroomId: number; attendanceDate: string },
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    await this.assertSchoolAccess(input.schoolId, actor);
    const assignments = await this.repository.listAttendanceDelegationAssignments(input);
    const teachers = await this.repository.listActiveTeacherMembershipsForSchool(input.schoolId);
    const activeDelegations = await this.repository.listActiveAttendanceDelegations(input);
    const actorId = resolveAuditActorId(actor);
    return {
      data: {
        assignments: assignments.map((assignment) => ({
          id: Number(assignment.assignment_id),
          assignmentKind: assignment.assignment_kind,
          subjectId: assignment.subject_id,
          subjectName: assignment.subject_name,
          timetableSlotId: assignment.timetable_slot_id
            ? Number(assignment.timetable_slot_id)
            : null,
          period: assignment.timetable_slot_period ?? null,
        })),
        teachers: teachers
          .filter((teacher) => teacher.teacher_user_id !== actorId)
          .map((teacher) => ({
            teacherMembershipId: Number(teacher.teacher_membership_id),
            teacherDisplayName: teacher.teacher_display_name,
          })),
        activeDelegations: activeDelegations.map((row) =>
          this.toAttendanceDelegation(row, baseUrl),
        ),
      },
    };
  }

  /** ประวัติการนำเข้าไฟล์ of the class a link opens. */
  async listPublicAttendanceImports(
    rawToken: string,
    query: {
      assignmentId: number;
      attendanceDate?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
    sessionToken?: string,
  ) {
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    return await this.withActiveGrantContext(
      rawToken,
      { assignmentId: query.assignmentId, sessionToken, operation: 'VIEW_ATTENDANCE_IMPORTS' },
      async (context) => {
        if (!context.classroomId) throw new ForbiddenException('ไม่พบห้องเรียนของลิงก์');
        const result = await this.attendanceImport.listApplied({
          classroomId: Number(context.classroomId),
          subjectId: context.subjectId ? Number(context.subjectId) : undefined,
          attendanceDate: query.attendanceDate,
          search: query.search?.trim() || undefined,
          page,
          limit,
        });
        return {
          data: result.rows,
          meta: buildPaginationMeta(page, limit, result.totalCount),
        };
      },
    );
  }

  /** Records an import applied through a teacher link. */
  async recordPublicAttendanceImport(
    rawToken: string,
    input: {
      assignmentId: number;
      attendanceDate: string;
      timetableSlotId?: number;
      fileName: string;
      sourceUrl?: string;
      rowCount: number;
      appliedCount: number;
      file?: Express.Multer.File;
    },
    sessionToken?: string,
  ) {
    return await this.withActiveGrantContext(
      rawToken,
      {
        assignmentId: input.assignmentId,
        sessionToken,
        operation: 'RECORD_ATTENDANCE_IMPORT',
      },
      async (context) => {
        if (!context.classroomId) throw new ForbiddenException('ไม่พบห้องเรียนของลิงก์');
        const recorded = await this.attendanceImport.recordApplied({
          schoolId: context.schoolId,
          schoolTermId: Number(context.schoolTermId),
          classroomId: Number(context.classroomId),
          attendanceDate: input.attendanceDate,
          timetableSlotId: input.timetableSlotId ?? null,
          subjectId: context.subjectId ? Number(context.subjectId) : null,
          fileName: input.fileName,
          sourceUrl: input.sourceUrl ?? null,
          rowCount: input.rowCount,
          appliedCount: input.appliedCount,
          // A link holder has no account row of their own to point at.
          importedBy: context.teacherUserId,
          importedByLabel: context.teacherDisplayName,
          file: input.file,
        });
        return { data: recorded };
      },
    );
  }

  /** Delegation history of a class for the staff screen. */
  async listAttendanceDelegationHistory(
    input: {
      schoolId: number;
      classroomId: number;
      subjectId?: number;
      attendanceDate?: string;
      search?: string;
      sortBy?: 'date' | 'issuedBy' | 'teacher' | 'status';
      sortDirection?: 'asc' | 'desc';
      page?: number;
      limit?: number;
    },
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    await this.assertSchoolAccess(input.schoolId, actor);
    const page = resolvePage(input.page);
    const limit = resolveLimit(input.limit);
    const rows = await this.repository.listAttendanceDelegationHistory({
      classroomId: input.classroomId,
      subjectId: input.subjectId,
      attendanceDate: input.attendanceDate,
      search: input.search?.trim() || undefined,
      sortBy: input.sortBy,
      sortDirection: input.sortDirection,
      page,
      limit,
    });
    return {
      data: rows.map((row) => this.toDelegationHistoryEntry(row, baseUrl)),
      meta: buildPaginationMeta(page, limit, Number(rows[0]?.total_count ?? 0)),
    };
  }

  /** The same history through a teacher link, scoped to the class it opens. */
  async listPublicAttendanceDelegationHistory(
    rawToken: string,
    query: {
      assignmentId: number;
      attendanceDate?: string;
      search?: string;
      sortBy?: 'date' | 'issuedBy' | 'teacher' | 'status';
      sortDirection?: 'asc' | 'desc';
      page?: number;
      limit?: number;
    },
    sessionToken: string | undefined,
    baseUrl: string,
  ) {
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    return await this.withActiveGrantContext(
      rawToken,
      {
        assignmentId: query.assignmentId,
        sessionToken,
        operation: 'VIEW_ATTENDANCE_DELEGATION_HISTORY',
      },
      async (context, queryRunner) => {
        if (context.accessScope === 'ATTENDANCE_ONLY') {
          throw new ForbiddenException('ลิงก์มอบหมายไม่มีประวัติการมอบหมาย');
        }
        if (!context.classroomId) {
          throw new ForbiddenException('ไม่พบห้องเรียนสำหรับการมอบหมาย');
        }
        const rows = await this.repository.listAttendanceDelegationHistory(
          {
            classroomId: Number(context.classroomId),
            // The link is opened on one subject, so its history answers about
            // that subject without asking the teacher to pick it again.
            subjectId: context.subjectId ? Number(context.subjectId) : undefined,
            attendanceDate: query.attendanceDate,
            search: query.search?.trim() || undefined,
            // A teacher sees the delegations they handed out for this class.
            assignmentTeacherMembershipId: Number(context.teacherMembershipId),
            sortBy: query.sortBy,
            sortDirection: query.sortDirection,
            page,
            limit,
          },
          queryRunner,
        );
        return {
          data: rows.map((row) => this.toDelegationHistoryEntry(row, baseUrl)),
          meta: buildPaginationMeta(page, limit, Number(rows[0]?.total_count ?? 0)),
        };
      },
    );
  }

  async issueAttendanceDelegation(
    dto: IssueTeacherAccessAttendanceDelegationDto,
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้ออกลิงก์');
    const { starts: startsAt, ends: endsAt } = this.resolveDelegationWindow({
      endsOn: dto.endsOn,
      endsAt: dto.endsAt,
    });

    return await this.repository.withTransaction(async (queryRunner) => {
      const term = await this.loadIssuableTerm(dto.schoolTermId, actor, queryRunner);
      if (term.school_id !== dto.schoolId) {
        throw new BadRequestException('โรงเรียนและภาคเรียนไม่ตรงกัน');
      }
      if (
        !term.starts_on ||
        dto.attendanceDate < term.starts_on ||
        dto.attendanceDate > term.ends_on
      ) {
        throw new BadRequestException('วันที่เช็กชื่อต้องอยู่ในช่วงภาคเรียน');
      }
      const recipient = await this.repository.findMembershipForIssue(
        dto.teacherMembershipId,
        queryRunner,
      );
      if (
        !recipient ||
        recipient.school_id !== dto.schoolId ||
        recipient.membership_status !== 'ACTIVE' ||
        recipient.teacher_status !== 'ACTIVE'
      ) {
        throw new BadRequestException('ครูผู้ได้รับมอบหมายต้องเป็นครูที่เปิดใช้งานในโรงเรียนนี้');
      }
      if (recipient.teacher_user_id === actorId) {
        throw new BadRequestException('ไม่สามารถมอบหมายการเช็กชื่อให้ตนเองได้');
      }
      if (
        !(await this.repository.lockAttendanceDelegationAssignment(dto.assignmentId, queryRunner))
      ) {
        throw new BadRequestException('ห้องหรือรายวิชาที่เลือกไม่พร้อมสำหรับวันที่มอบหมาย');
      }
      const assignment = await this.repository.findAttendanceDelegationAssignment(
        {
          assignmentId: dto.assignmentId,
          schoolId: dto.schoolId,
          schoolTermId: dto.schoolTermId,
          attendanceDate: dto.attendanceDate,
          timetableSlotId: dto.timetableSlotId ?? null,
        },
        queryRunner,
      );
      if (!assignment) {
        throw new ConflictException('วิชาหรือคาบนี้ถูกมอบหมายแล้ว');
      }
      if (
        (assignment.assignment_kind === 'SUBJECT' && !dto.timetableSlotId) ||
        (assignment.assignment_kind === 'HOMEROOM' && dto.timetableSlotId)
      ) {
        throw new BadRequestException('กรุณาเลือกรายวิชาและคาบที่ถูกต้อง');
      }
      const rawToken = generateToken();
      const grantId = await this.repository.createAttendanceDelegationGrant(
        {
          teacherMembershipId: dto.teacherMembershipId,
          schoolId: dto.schoolId,
          schoolTermId: dto.schoolTermId,
          tokenHash: hashToken(rawToken),
          tokenEncrypted: this.tokenEncryption.encrypt(rawToken),
          stepUpPolicy: TEACHER_ACCESS_DEFAULT_STEP_UP_POLICY,
          issuedBy: actorId,
          startsAt,
          endsAt,
          expiresAt: endsAt,
          attendanceDate: dto.attendanceDate,
          timetableSlotId: dto.timetableSlotId ?? null,
          assignment,
          capability: this.attendanceCapability(assignment.assignment_kind),
        },
        queryRunner,
      );
      const detail = await this.repository.getGrantDetail(grantId, queryRunner);
      if (!detail) throw new ConflictException('สร้างลิงก์มอบหมายการเช็กชื่อไม่สำเร็จ');
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'TEACHER_ACCESS_GRANT_ISSUE',
          targetType: 'teacher_access_grants',
          targetId: grantId,
          metadata: {
            schoolId: dto.schoolId,
            teacherMembershipId: dto.teacherMembershipId,
            assignmentId: dto.assignmentId,
            attendanceDate: dto.attendanceDate,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
          ip: null,
        },
        queryRunner,
      );
      return {
        data: {
          ...this.toGrant(detail.grant),
          accessUrl: this.buildAccessUrl(baseUrl, rawToken),
        },
      };
    });
  }

  async listPublicAttendanceDelegationOptions(
    rawToken: string,
    input: { assignmentId: number; attendanceDate: string },
    sessionToken: string | undefined,
    baseUrl: string,
  ) {
    return await this.withActiveGrantContext(
      rawToken,
      {
        assignmentId: input.assignmentId,
        sessionToken,
        operation: 'VIEW_ATTENDANCE_DELEGATION_OPTIONS',
      },
      async (context, queryRunner) => {
        if (!context.classroomId) {
          throw new ForbiddenException('ไม่พบห้องเรียนสำหรับการมอบหมาย');
        }
        const assignments = await this.repository.listAttendanceDelegationAssignments(
          {
            schoolId: context.schoolId,
            schoolTermId: Number(context.schoolTermId),
            classroomId: Number(context.classroomId),
            teacherMembershipId: Number(context.teacherMembershipId),
            attendanceDate: input.attendanceDate,
          },
          queryRunner,
        );
        const teachers = await this.repository.listActiveTeacherMembershipsForSchool(
          context.schoolId,
          queryRunner,
        );
        const activeDelegations = await this.repository.listActiveAttendanceDelegations(
          {
            schoolId: context.schoolId,
            schoolTermId: Number(context.schoolTermId),
            classroomId: Number(context.classroomId),
            attendanceDate: input.attendanceDate,
            assignmentTeacherMembershipId: Number(context.teacherMembershipId),
          },
          queryRunner,
        );
        return {
          data: {
            assignments: assignments.map((assignment) => ({
              id: Number(assignment.assignment_id),
              assignmentKind: assignment.assignment_kind,
              subjectId: assignment.subject_id,
              subjectName: assignment.subject_name,
              timetableSlotId: assignment.timetable_slot_id
                ? Number(assignment.timetable_slot_id)
                : null,
              period: assignment.timetable_slot_period ?? null,
            })),
            teachers: teachers
              .filter(
                (teacher) =>
                  Number(teacher.teacher_membership_id) !== Number(context.teacherMembershipId),
              )
              .map((teacher) => ({
                teacherMembershipId: Number(teacher.teacher_membership_id),
                teacherDisplayName: teacher.teacher_display_name,
              })),
            activeDelegations: activeDelegations.map((row) =>
              this.toAttendanceDelegation(row, baseUrl),
            ),
          },
        };
      },
    );
  }

  async issuePublicAttendanceDelegation(
    rawToken: string,
    dto: IssuePublicTeacherAccessAttendanceDelegationDto,
    baseUrl: string,
    sessionToken?: string,
  ) {
    const { starts: startsAt, ends: endsAt } = this.resolveDelegationWindow({
      endsOn: dto.endsOn,
      endsAt: dto.endsAt,
    });
    return await this.withActiveGrantContext(
      rawToken,
      {
        assignmentId: dto.assignmentId,
        sessionToken,
        operation: 'ISSUE_ATTENDANCE_DELEGATION',
        recordSuccessfulUse: false,
      },
      async (context, queryRunner) => {
        if (!context.classroomId) {
          throw new ForbiddenException('ไม่พบห้องเรียนสำหรับการมอบหมาย');
        }
        const term = await this.repository.findTermForIssue(
          Number(context.schoolTermId),
          queryRunner,
        );
        if (
          !term ||
          term.school_id !== context.schoolId ||
          term.status !== 'ACTIVE' ||
          !term.starts_on ||
          !term.ends_on
        ) {
          throw new ForbiddenException('ภาคเรียนของลิงก์นี้ไม่พร้อมออกลิงก์มอบหมาย');
        }
        if (dto.attendanceDate < term.starts_on || dto.attendanceDate > term.ends_on) {
          throw new BadRequestException('วันที่เช็กชื่อต้องอยู่ในช่วงภาคเรียน');
        }
        const recipient = await this.repository.findMembershipForIssue(
          dto.teacherMembershipId,
          queryRunner,
        );
        if (
          !recipient ||
          recipient.school_id !== context.schoolId ||
          recipient.membership_status !== 'ACTIVE' ||
          recipient.teacher_status !== 'ACTIVE'
        ) {
          throw new BadRequestException('ครูผู้ได้รับมอบหมายต้องเป็นครูที่เปิดใช้งานในโรงเรียนนี้');
        }
        if (dto.teacherMembershipId === Number(context.teacherMembershipId)) {
          throw new BadRequestException('ไม่สามารถมอบหมายการเช็กชื่อให้ตนเองได้');
        }
        if (
          !(await this.repository.lockAttendanceDelegationAssignment(dto.assignmentId, queryRunner))
        ) {
          throw new ForbiddenException('รายวิชาที่เลือกอยู่นอกขอบเขตของลิงก์ครู');
        }
        const assignment = await this.repository.findAttendanceDelegationAssignment(
          {
            assignmentId: dto.assignmentId,
            schoolId: context.schoolId,
            schoolTermId: Number(context.schoolTermId),
            attendanceDate: dto.attendanceDate,
            timetableSlotId: dto.timetableSlotId ?? null,
          },
          queryRunner,
        );
        if (
          !assignment ||
          Number(assignment.classroom_id) !== Number(context.classroomId) ||
          Number(assignment.teacher_membership_id) !== Number(context.teacherMembershipId)
        ) {
          throw new ForbiddenException('รายวิชาที่เลือกอยู่นอกขอบเขตของลิงก์ครู');
        }
        if (
          (assignment.assignment_kind === 'SUBJECT' && !dto.timetableSlotId) ||
          (assignment.assignment_kind === 'HOMEROOM' && dto.timetableSlotId)
        ) {
          throw new BadRequestException('กรุณาเลือกรายวิชาและคาบที่ถูกต้อง');
        }
        const rawChildToken = generateToken();
        const grantId = await this.repository.createAttendanceDelegationGrant(
          {
            teacherMembershipId: dto.teacherMembershipId,
            schoolId: context.schoolId,
            schoolTermId: Number(context.schoolTermId),
            tokenHash: hashToken(rawChildToken),
            tokenEncrypted: this.tokenEncryption.encrypt(rawChildToken),
            stepUpPolicy: TEACHER_ACCESS_DEFAULT_STEP_UP_POLICY,
            // A teacher link may belong to a teacher without a normal user account;
            // retain the original issuer FK and record the acting teacher in audit metadata.
            issuedBy: context.issuerUserId,
            startsAt,
            endsAt,
            expiresAt: endsAt,
            attendanceDate: dto.attendanceDate,
            timetableSlotId: dto.timetableSlotId ?? null,
            assignment,
            capability: this.attendanceCapability(assignment.assignment_kind),
          },
          queryRunner,
        );
        const detail = await this.repository.getGrantDetail(grantId, queryRunner);
        if (!detail) throw new ConflictException('สร้างลิงก์มอบหมายการเช็กชื่อไม่สำเร็จ');
        await this.auditLog.recordAtomic(
          {
            actorUserId: context.teacherUserId,
            actorLabel: context.teacherDisplayName,
            action: 'TEACHER_ACCESS_GRANT_ISSUE',
            targetType: 'teacher_access_grants',
            targetId: grantId,
            metadata: {
              schoolId: context.schoolId,
              teacherMembershipId: dto.teacherMembershipId,
              assignmentId: dto.assignmentId,
              attendanceDate: dto.attendanceDate,
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              issuedViaGrantId: context.grantId,
            },
            ip: null,
          },
          queryRunner,
        );
        return {
          data: {
            ...this.toGrant(detail.grant),
            accessUrl: this.buildAccessUrl(baseUrl, rawChildToken),
          },
        };
      },
    );
  }

  async getGrant(grantId: string, actor: AuthenticatedRequestUser) {
    const detail = await this.repository.getGrantDetail(grantId);
    if (!detail) throw new NotFoundException('ไม่พบลิงก์เข้าใช้งานครู');
    await this.assertSchoolAccess(detail.grant.school_id, actor);
    return {
      data: {
        ...this.toGrant(detail.grant),
        assignments: detail.assignments.map((row) => this.toAssignment(row, detail.capabilities)),
      },
    };
  }

  /** Today in Bangkok, which is where a link's own dates default from. */
  private bangkokToday(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
  }

  /**
   * A delegation link lives on its own clock, not the round's: attendance is
   * checked for days that have already passed, so the link starts the moment it
   * is issued and runs until the expiry the issuer picked (defaulting to the end
   * of today). `attendanceDate` only says which round it covers.
   */
  private resolveDelegationWindow(input: { endsOn?: string; endsAt?: string; startsAt?: Date }): {
    starts: Date;
    ends: Date;
  } {
    const starts = input.startsAt ?? new Date();
    const endsOn = input.endsOn ?? this.bangkokToday();
    const ends = new Date(`${endsOn}T${input.endsAt ?? '23:59'}:00+07:00`);
    if (!Number.isFinite(ends.getTime())) {
      throw new BadRequestException('วันหรือเวลาหมดอายุลิงก์ไม่ถูกต้อง');
    }
    if (ends <= starts) {
      throw new BadRequestException('วันและเวลาที่ลิงก์หมดอายุต้องอยู่หลังเวลาที่เริ่มใช้ลิงก์');
    }
    return { starts, ends };
  }

  /**
   * Moving a delegation to another teacher is not an edit of the same link: the
   * teacher who had it must lose access, and the new one needs a link of their
   * own. So the old grant is closed and a fresh one is issued for the same round
   * inside one transaction, and the caller gets the new URL back to hand over.
   */
  private async reassignAttendanceDelegation(
    input: {
      grantId: string;
      teacherMembershipId: number;
      schoolId: number;
      startsAt: Date;
      endsAt: Date;
      issuedBy: number;
      actorUserId: number | null;
      actorLabel: string;
      issuedViaGrantId?: string;
    },
    queryRunner: QueryRunner,
  ): Promise<{ grantId: string; rawToken: string }> {
    const recipient = await this.repository.findMembershipForIssue(
      input.teacherMembershipId,
      queryRunner,
    );
    if (
      !recipient ||
      recipient.school_id !== input.schoolId ||
      recipient.membership_status !== 'ACTIVE' ||
      recipient.teacher_status !== 'ACTIVE'
    ) {
      throw new BadRequestException('ครูผู้ได้รับมอบหมายต้องเป็นครูที่เปิดใช้งานในโรงเรียนนี้');
    }
    const scope = await this.repository.findAttendanceDelegationScope(input.grantId, queryRunner);
    const assignment = await this.repository.findRestrictedAttendanceAssignment(
      input.grantId,
      queryRunner,
    );
    if (!scope || !assignment) {
      throw new NotFoundException('ไม่พบลิงก์มอบหมายการเช็กชื่อ');
    }
    if (Number(assignment.teacher_membership_id) === input.teacherMembershipId) {
      throw new BadRequestException('ไม่สามารถมอบหมายการเช็กชื่อให้ตนเองได้');
    }
    await this.repository.revokeGrant(
      input.grantId,
      input.issuedBy,
      'REASSIGNED_TO_ANOTHER_TEACHER',
      queryRunner,
    );
    const rawToken = generateToken();
    const reissuedGrantId = await this.repository.createAttendanceDelegationGrant(
      {
        teacherMembershipId: input.teacherMembershipId,
        schoolId: input.schoolId,
        schoolTermId: Number(scope.school_term_id),
        tokenHash: hashToken(rawToken),
        tokenEncrypted: this.tokenEncryption.encrypt(rawToken),
        stepUpPolicy: TEACHER_ACCESS_DEFAULT_STEP_UP_POLICY,
        issuedBy: input.issuedBy,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        expiresAt: input.endsAt,
        attendanceDate: scope.attendance_date,
        timetableSlotId: scope.timetable_slot_id ? Number(scope.timetable_slot_id) : null,
        assignment,
        capability: this.attendanceCapability(assignment.assignment_kind),
      },
      queryRunner,
    );
    await this.auditLog.recordAtomic(
      {
        actorUserId: input.actorUserId,
        actorLabel: input.actorLabel,
        action: 'TEACHER_ACCESS_GRANT_ISSUE',
        targetType: 'teacher_access_grants',
        targetId: reissuedGrantId,
        metadata: {
          schoolId: input.schoolId,
          teacherMembershipId: input.teacherMembershipId,
          assignmentId: Number(scope.assignment_id),
          attendanceDate: scope.attendance_date,
          startsAt: input.startsAt.toISOString(),
          endsAt: input.endsAt.toISOString(),
          reassignedFromGrantId: input.grantId,
          ...(input.issuedViaGrantId ? { issuedViaGrantId: input.issuedViaGrantId } : {}),
        },
        ip: null,
      },
      queryRunner,
    );
    return { grantId: reissuedGrantId, rawToken };
  }

  async updateAttendanceDelegation(
    grantId: string,
    dto: UpdateTeacherAccessAttendanceDelegationDto,
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้แก้ไขลิงก์มอบหมาย');
    return await this.repository.withTransaction(async (queryRunner) => {
      const detail = await this.repository.getGrantDetail(grantId, queryRunner, true);
      if (
        !detail ||
        detail.grant.access_scope !== 'ATTENDANCE_ONLY' ||
        !detail.grant.attendance_date
      ) {
        throw new NotFoundException('ไม่พบลิงก์มอบหมายการเช็กชื่อ');
      }
      if (detail.grant.school_id !== dto.schoolId) {
        throw new BadRequestException('โรงเรียนของลิงก์มอบหมายไม่ตรงกัน');
      }
      await this.assertSchoolAccess(dto.schoolId, actor);
      if (detail.grant.revoked_at || new Date(detail.grant.expires_at).getTime() <= Date.now()) {
        throw new GoneException('ลิงก์มอบหมายถูกปิดหรือหมดอายุแล้ว');
      }
      // Editing never moves the start — the link has been usable since it was
      // issued — so only its expiry is recomputed.
      const scope = await this.repository.findAttendanceDelegationScope(grantId, queryRunner);
      const window = this.resolveDelegationWindow({
        endsOn: dto.endsOn,
        endsAt: dto.endsAt,
        startsAt: scope ? new Date(scope.starts_at) : undefined,
      });
      if (
        dto.teacherMembershipId &&
        dto.teacherMembershipId !== Number(detail.grant.teacher_membership_id)
      ) {
        const reissued = await this.reassignAttendanceDelegation(
          {
            grantId,
            teacherMembershipId: dto.teacherMembershipId,
            schoolId: dto.schoolId,
            startsAt: window.starts,
            endsAt: window.ends,
            issuedBy: actorId,
            actorUserId: actorId,
            actorLabel: actor.username,
          },
          queryRunner,
        );
        return {
          data: {
            grantId: reissued.grantId,
            startsAt: window.starts.toISOString(),
            endsAt: window.ends.toISOString(),
            accessUrl: this.buildAccessUrl(baseUrl, reissued.rawToken),
          },
        };
      }
      if (
        !(await this.repository.updateAttendanceDelegationWindow(
          grantId,
          window.starts,
          window.ends,
          window.ends,
          queryRunner,
        ))
      ) {
        throw new GoneException('ลิงก์มอบหมายถูกปิดหรือหมดอายุแล้ว');
      }
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'TEACHER_ACCESS_GRANT_UPDATE',
          targetType: 'teacher_access_grants',
          targetId: grantId,
          metadata: { startsAt: window.starts.toISOString(), endsAt: window.ends.toISOString() },
          ip: null,
        },
        queryRunner,
      );
      return {
        data: { grantId, startsAt: window.starts.toISOString(), endsAt: window.ends.toISOString() },
      };
    });
  }

  async updatePublicAttendanceDelegation(
    rawToken: string,
    grantId: string,
    dto: UpdatePublicTeacherAccessAttendanceDelegationDto & { assignmentId: number },
    sessionToken?: string,
    baseUrl?: string,
  ) {
    return await this.withActiveGrantContext(
      rawToken,
      { assignmentId: dto.assignmentId, sessionToken, operation: 'UPDATE_ATTENDANCE_DELEGATION' },
      async (context, queryRunner) => {
        if (context.accessScope === 'ATTENDANCE_ONLY') {
          throw new ForbiddenException('ลิงก์มอบหมายไม่สามารถแก้ไขลิงก์อื่นได้');
        }
        const delegatedAssignment = await this.repository.findRestrictedAttendanceAssignment(
          grantId,
          queryRunner,
        );
        if (
          !delegatedAssignment ||
          Number(delegatedAssignment.classroom_id) !== Number(context.classroomId) ||
          Number(delegatedAssignment.teacher_membership_id) !== Number(context.teacherMembershipId)
        ) {
          throw new NotFoundException('ไม่พบลิงก์มอบหมายการเช็กชื่อ');
        }
        const detail = await this.repository.getGrantDetail(grantId, queryRunner, true);
        if (
          !detail ||
          detail.grant.access_scope !== 'ATTENDANCE_ONLY' ||
          !detail.grant.attendance_date
        ) {
          throw new NotFoundException('ไม่พบลิงก์มอบหมายการเช็กชื่อ');
        }
        const scope = await this.repository.findAttendanceDelegationScope(grantId, queryRunner);
        const window = this.resolveDelegationWindow({
          endsOn: dto.endsOn,
          endsAt: dto.endsAt,
          startsAt: scope ? new Date(scope.starts_at) : undefined,
        });
        if (
          dto.teacherMembershipId &&
          dto.teacherMembershipId !== Number(detail.grant.teacher_membership_id)
        ) {
          if (dto.teacherMembershipId === Number(context.teacherMembershipId)) {
            throw new BadRequestException('ไม่สามารถมอบหมายการเช็กชื่อให้ตนเองได้');
          }
          const reissued = await this.reassignAttendanceDelegation(
            {
              grantId,
              teacherMembershipId: dto.teacherMembershipId,
              schoolId: context.schoolId,
              startsAt: window.starts,
              endsAt: window.ends,
              issuedBy: context.issuerUserId,
              actorUserId: context.teacherUserId,
              actorLabel: context.teacherDisplayName,
              issuedViaGrantId: context.grantId,
            },
            queryRunner,
          );
          return {
            data: {
              grantId: reissued.grantId,
              startsAt: window.starts.toISOString(),
              endsAt: window.ends.toISOString(),
              accessUrl: baseUrl ? this.buildAccessUrl(baseUrl, reissued.rawToken) : null,
            },
          };
        }
        if (
          !(await this.repository.updateAttendanceDelegationWindow(
            grantId,
            window.starts,
            window.ends,
            window.ends,
            queryRunner,
          ))
        ) {
          throw new GoneException('ลิงก์มอบหมายถูกปิดหรือหมดอายุแล้ว');
        }
        return {
          data: {
            grantId,
            startsAt: window.starts.toISOString(),
            endsAt: window.ends.toISOString(),
          },
        };
      },
    );
  }

  async revokePublicAttendanceDelegation(
    rawToken: string,
    grantId: string,
    assignmentId: number,
    sessionToken?: string,
  ) {
    return await this.withActiveGrantContext(
      rawToken,
      { assignmentId, sessionToken, operation: 'REVOKE_ATTENDANCE_DELEGATION' },
      async (context, queryRunner) => {
        if (context.accessScope === 'ATTENDANCE_ONLY') {
          throw new ForbiddenException('ลิงก์มอบหมายไม่สามารถปิดลิงก์อื่นได้');
        }
        const delegatedAssignment = await this.repository.findRestrictedAttendanceAssignment(
          grantId,
          queryRunner,
        );
        if (
          !delegatedAssignment ||
          Number(delegatedAssignment.classroom_id) !== Number(context.classroomId) ||
          Number(delegatedAssignment.teacher_membership_id) !== Number(context.teacherMembershipId)
        ) {
          throw new NotFoundException('ไม่พบลิงก์มอบหมายการเช็กชื่อ');
        }
        const detail = await this.repository.getGrantDetail(grantId, queryRunner, true);
        if (!detail || detail.grant.access_scope !== 'ATTENDANCE_ONLY' || detail.grant.revoked_at) {
          throw new GoneException('ลิงก์มอบหมายถูกปิดหรือหมดอายุแล้ว');
        }
        await this.repository.revokeGrant(
          grantId,
          context.teacherUserId ?? context.issuerUserId,
          'REVOKED_BY_ASSIGNMENT_TEACHER',
          queryRunner,
        );
        return { data: { grantId, revoked: true } };
      },
    );
  }

  async revokeAttendanceDelegation(grantId: string, actor: AuthenticatedRequestUser) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้ปิดลิงก์มอบหมาย');
    return await this.repository.withTransaction(async (queryRunner) => {
      const detail = await this.repository.getGrantDetail(grantId, queryRunner, true);
      if (!detail || detail.grant.access_scope !== 'ATTENDANCE_ONLY') {
        throw new NotFoundException('ไม่พบลิงก์มอบหมายการเช็กชื่อ');
      }
      await this.assertSchoolAccess(detail.grant.school_id, actor);
      if (detail.grant.revoked_at) {
        throw new GoneException('ลิงก์มอบหมายถูกปิดหรือหมดอายุแล้ว');
      }
      await this.repository.revokeGrant(grantId, actorId, 'REVOKED_BY_SCHOOL_ADMIN', queryRunner);
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'TEACHER_ACCESS_GRANT_REVOKE',
          targetType: 'teacher_access_grants',
          targetId: grantId,
          metadata: {
            schoolId: detail.grant.school_id,
            teacherName: detail.grant.teacher_display_name,
            reason: 'REVOKED_BY_SCHOOL_ADMIN',
          },
          ip: null,
        },
        createSqlQueryExecutor(queryRunner),
      );
      return { data: { grantId, revoked: true } };
    });
  }

  async revokeGrant(grantId: string, reason: string, actor: AuthenticatedRequestUser) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้ยกเลิกลิงก์');
    const detail = await this.repository.withTransaction(async (queryRunner) => {
      const current = await this.repository.getGrantDetail(grantId, queryRunner, true);
      if (!current) throw new NotFoundException('ไม่พบลิงก์เข้าใช้งานครู');
      await this.assertSchoolAccess(current.grant.school_id, actor);
      this.assertTermLinkGrant(current.grant);
      if (!current.grant.revoked_at) {
        await this.repository.revokeGrant(grantId, actorId, reason, queryRunner);
        await this.auditLog.recordAtomic(
          {
            actorUserId: actorId,
            actorLabel: actor.username,
            action: 'TEACHER_ACCESS_GRANT_REVOKE',
            targetType: 'teacher_access_grants',
            targetId: grantId,
            metadata: {
              schoolId: current.grant.school_id,
              teacherName: current.grant.teacher_display_name,
              reason,
            },
            ip: null,
          },
          createSqlQueryExecutor(queryRunner),
        );
      }
      return (await this.repository.getGrantDetail(grantId, queryRunner))!;
    });
    return { data: this.toGrant(detail.grant) };
  }

  async rotateGrant(grantId: string, actor: AuthenticatedRequestUser, baseUrl: string) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้หมุนลิงก์');
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const detail = await this.repository.withTransaction(async (queryRunner) => {
      const current = await this.repository.getGrantDetail(grantId, queryRunner, true);
      if (!current) throw new NotFoundException('ไม่พบลิงก์เข้าใช้งานครู');
      await this.assertSchoolAccess(current.grant.school_id, actor);
      this.assertTermLinkGrant(current.grant);
      if (this.grantStatus(current.grant) !== 'ACTIVE') {
        throw new ConflictException('หมุนได้เฉพาะลิงก์ที่เปิดใช้งาน');
      }
      await this.repository.rotateGrantToken(
        grantId,
        tokenHash,
        this.tokenEncryption.encrypt(rawToken),
        queryRunner,
      );
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'TEACHER_ACCESS_GRANT_ROTATE',
          targetType: 'teacher_access_grants',
          targetId: grantId,
          metadata: {
            schoolId: current.grant.school_id,
            teacherName: current.grant.teacher_display_name,
            rotationCount: Number(current.grant.rotation_count) + 1,
          },
          ip: null,
        },
        queryRunner,
      );
      return (await this.repository.getGrantDetail(grantId, queryRunner))!;
    });
    return {
      data: {
        ...this.toGrant(detail.grant),
        accessUrl: this.buildAccessUrl(baseUrl, rawToken),
      },
    };
  }

  private assertGrantUsable(grant: TeacherAccessGrantRow): void {
    if (grant.revoked_at) {
      // A delegation is closed by the teacher who handed it out, and the person
      // holding it has no way to guess that — name the link so they know which
      // one died and who to ask.
      throw new GoneException(
        grant.access_scope === 'ATTENDANCE_ONLY'
          ? 'ลิงก์มอบหมายการเช็กชื่อนี้ถูกปิดแล้ว กรุณาติดต่อครูผู้มอบหมาย'
          : 'ลิงก์นี้ถูกเพิกถอนแล้ว',
      );
    }
    if (new Date(grant.expires_at).getTime() <= Date.now()) {
      throw new GoneException('ลิงก์นี้หมดอายุแล้ว');
    }
    if (grant.teacher_status !== 'ACTIVE') {
      throw new ForbiddenException('บัญชีผู้ใช้ครูถูกปิดใช้งาน');
    }
    if (grant.membership_status !== 'ACTIVE' || grant.membership_deleted_at) {
      throw new ForbiddenException('บัญชีครูนี้ไม่ได้ปฏิบัติงานในโรงเรียนแล้ว');
    }
    if (grant.school_status !== 'ACTIVE') {
      throw new ForbiddenException('โรงเรียนของลิงก์นี้ไม่ได้เปิดใช้งาน');
    }
    if (grant.term_status !== 'ACTIVE' || grant.term_deleted_at) {
      throw new ForbiddenException('ภาคเรียนของลิงก์นี้ไม่ได้เปิดใช้งาน');
    }
    const today = getBangkokDateString();
    if (
      !grant.term_starts_on ||
      !grant.term_ends_on ||
      today < grant.term_starts_on ||
      today > grant.term_ends_on
    ) {
      throw new ForbiddenException('ลิงก์นี้อยู่นอกช่วงภาคเรียน');
    }
    if (grant.access_scope === 'ATTENDANCE_ONLY') {
      const startsAt = grant.attendance_starts_at ? new Date(grant.attendance_starts_at) : null;
      const endsAt = grant.attendance_ends_at ? new Date(grant.attendance_ends_at) : null;
      if (!startsAt || !endsAt || !grant.attendance_date) {
        throw new ForbiddenException('ข้อมูลช่วงเวลาของลิงก์เช็กชื่อไม่ครบถ้วน');
      }
      const now = Date.now();
      if (getBangkokDateString() !== grant.attendance_date || now < startsAt.getTime()) {
        throw new ForbiddenException('ลิงก์เช็กชื่อยังไม่ถึงเวลาใช้งาน');
      }
      if (now >= endsAt.getTime()) {
        throw new GoneException('ลิงก์เช็กชื่อหมดเวลาใช้งานแล้ว');
      }
    }
  }

  /**
   * Step-up gate. Thrown as 401 (not 403) so the guest page can tell "prove it
   * is you" apart from "this link may not do that" and show the OTP form.
   */
  private async assertStepUpSatisfied(
    grant: TeacherAccessGrantRow,
    sessionToken: string | undefined,
  ): Promise<void> {
    if (grant.step_up_policy === 'NONE') return;
    if (grant.step_up_policy !== 'EMAIL_OTP' && grant.step_up_policy !== 'THAID') {
      throw new ForbiddenException('ลิงก์นี้ต้องยืนยันตัวตนเพิ่มเติม');
    }
    const verified = await this.magicSessionStore.isVerified(grant.id, sessionToken);
    if (!verified) {
      throw new UnauthorizedException('OTP_REQUIRED');
    }
  }

  private assertAssignmentUsable(
    grant: TeacherAccessGrantRow,
    assignment: TeacherAccessAssignmentRow,
    capability?: TeacherAccessCapability,
  ): void {
    if (
      assignment.school_id !== grant.school_id ||
      assignment.school_term_id !== grant.school_term_id ||
      (grant.access_scope !== 'ATTENDANCE_ONLY' &&
        assignment.teacher_membership_id !== grant.teacher_membership_id)
    ) {
      throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
    }
    if (!this.assignmentActiveToday(assignment)) {
      throw new ForbiddenException('assignment นี้ไม่ได้เปิดใช้งาน');
    }
    if (
      (capability === 'HOMEROOM_ATTENDANCE' || capability === 'SUBJECT_ATTENDANCE') &&
      capability !== this.attendanceCapability(assignment.assignment_kind)
    ) {
      throw new ForbiddenException('ลิงก์นี้ไม่มีสิทธิ์เช็กชื่อใน assignment นี้');
    }
    if (capability === 'TEACHER_OBSERVATION' && assignment.assignment_kind !== 'SUBJECT') {
      throw new ForbiddenException('ลิงก์นี้ไม่มีสิทธิ์บันทึกข้อสังเกตใน assignment นี้');
    }
  }

  private toActiveContext(
    detail: TeacherAccessGrantDetail,
    assignment: TeacherAccessAssignmentRow | null,
  ): ActiveTeacherGrantContext {
    return {
      grantId: detail.grant.id,
      teacherMembershipId: detail.grant.teacher_membership_id,
      teacherUserId: detail.grant.teacher_user_id,
      teacherUsername: detail.grant.teacher_username,
      teacherDisplayName: detail.grant.teacher_display_name,
      issuerUserId: detail.grant.issued_by,
      schoolId: detail.grant.school_id,
      schoolName: detail.grant.school_name,
      schoolTermId: detail.grant.school_term_id,
      academicYear: detail.grant.academic_year,
      semester: detail.grant.semester,
      assignmentId: assignment?.assignment_id ?? null,
      classroomId: assignment?.classroom_id ?? null,
      subjectId: assignment?.subject_id ?? null,
      capabilities: detail.capabilities,
      accessScope: detail.grant.access_scope === 'ATTENDANCE_ONLY' ? 'ATTENDANCE_ONLY' : 'FULL',
      attendanceDate: detail.grant.attendance_date,
    };
  }

  /**
   * Transaction-safe extension point for P4 observation writes. The callback
   * runs while the grant row is locked, so revoke/rotate and the domain write
   * cannot race each other.
   */
  async withActiveGrantContext<T>(
    rawToken: string,
    options: ActiveGrantOperationOptions,
    operation: (context: ActiveTeacherGrantContext, queryRunner: QueryRunner) => Promise<T>,
  ): Promise<T> {
    const token = rawToken.trim();
    if (token.length < 32 || token.length > 256) {
      throw new NotFoundException('ไม่พบลิงก์เข้าใช้งาน');
    }
    let deniedGrant: TeacherAccessGrantRow | null = null;
    try {
      return await this.repository.withTransaction(async (queryRunner) => {
        const grant = await this.repository.findGrantByTokenHashForUpdate(
          hashToken(token),
          queryRunner,
        );
        if (!grant) throw new NotFoundException('ไม่พบลิงก์เข้าใช้งาน');
        deniedGrant = grant;
        this.assertGrantUsable(grant);
        await this.assertStepUpSatisfied(grant, options.sessionToken);
        if (grant.access_scope === 'ATTENDANCE_ONLY') {
          if (
            ![
              'VIEW_CONTEXT',
              'VIEW_ROSTER',
              'VIEW_ATTENDANCE_SLOTS',
              'VIEW_ATTENDANCE_DRAFT',
              'SUBMIT_ATTENDANCE_DRAFT',
              'SUBMIT_ATTENDANCE',
              'PARSE_ATTENDANCE_IMPORT',
            ].includes(options.operation)
          ) {
            throw new ForbiddenException('ลิงก์นี้ใช้ได้เฉพาะการเช็กชื่อที่ได้รับมอบหมาย');
          }
        } else {
          await this.repository.syncGrantScopeFromAssignments(
            grant.id,
            getBangkokDateString(),
            queryRunner,
          );
        }
        const capabilities = await this.repository.listCapabilities(grant.id, queryRunner);
        if (options.capability && !capabilities.includes(options.capability)) {
          throw new ForbiddenException('ลิงก์นี้ไม่มี capability ที่ร้องขอ');
        }
        const assignment = options.assignmentId
          ? grant.access_scope === 'ATTENDANCE_ONLY'
            ? await this.repository.findRestrictedAttendanceAssignment(grant.id, queryRunner)
            : await this.repository.findGrantAssignment(grant.id, options.assignmentId, queryRunner)
          : null;
        if (
          grant.access_scope === 'ATTENDANCE_ONLY' &&
          options.assignmentId &&
          assignment &&
          Number(assignment.assignment_id) !== options.assignmentId
        ) {
          throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
        }
        if (options.assignmentId && !assignment) {
          throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
        }
        if (assignment) this.assertAssignmentUsable(grant, assignment, options.capability);
        if (options.studentUuid) {
          if (!assignment) throw new ForbiddenException('ต้องระบุ assignment สำหรับนักเรียน');
          const inRoster = await this.repository.isStudentInClassroom(
            options.studentUuid,
            Number(assignment.classroom_id),
            queryRunner,
          );
          if (!inRoster) throw new ForbiddenException('นักเรียนอยู่นอก roster ของ assignment');
        }
        const detail: TeacherAccessGrantDetail = { grant, capabilities, assignments: [] };
        const context = this.toActiveContext(detail, assignment);
        const result = await operation(context, queryRunner);
        if (options.recordSuccessfulUse !== false) {
          await this.repository.touchGrant(grant.id, queryRunner);
          await this.auditLog.recordAtomic(
            {
              actorUserId: grant.teacher_user_id,
              actorLabel: grant.teacher_username,
              action: 'TEACHER_ACCESS_GRANT_USE',
              targetType: 'teacher_access_grants',
              targetId: grant.id,
              metadata: {
                schoolId: grant.school_id,
                teacherName: grant.teacher_display_name,
                operation: options.operation,
                assignmentId: assignment?.assignment_id ?? null,
              },
              ip: null,
            },
            queryRunner,
          );
        }
        return result;
      });
    } catch (error) {
      const denialContext = deniedGrant as TeacherAccessGrantRow | null;
      if (denialContext) {
        await this.auditLog.record({
          actorUserId: denialContext.teacher_user_id,
          actorLabel: denialContext.teacher_username,
          action: 'TEACHER_ACCESS_GRANT_DENIED',
          targetType: 'teacher_access_grants',
          targetId: denialContext.id,
          metadata: {
            schoolId: denialContext.school_id,
            teacherName: denialContext.teacher_display_name,
            operation: options.operation,
            reason: error instanceof Error ? error.message : 'ACCESS_DENIED',
          },
          ip: null,
        });
      }
      throw error;
    }
  }

  /**
   * Loads the grant a raw link token points at, for the step-up flow only — it
   * deliberately runs before the OTP gate, so it must never expose anything but
   * whether the link works and where the code will be sent.
   */
  private async findUsableGrantForVerification(rawToken: string): Promise<TeacherAccessGrantRow> {
    const token = rawToken.trim();
    if (token.length < 32 || token.length > 256) {
      throw new NotFoundException('ไม่พบลิงก์เข้าใช้งาน');
    }
    const grant = await this.repository.withTransaction(async (queryRunner) =>
      this.repository.findGrantByTokenHashForUpdate(hashToken(token), queryRunner),
    );
    if (!grant) throw new NotFoundException('ไม่พบลิงก์เข้าใช้งาน');
    this.assertGrantUsable(grant);
    return grant;
  }

  async requestOtp(rawToken: string) {
    const grant = await this.findUsableGrantForVerification(rawToken);
    if (grant.step_up_policy !== 'EMAIL_OTP') {
      throw new BadRequestException('ลิงก์นี้ไม่ได้ใช้การยืนยันด้วยรหัส OTP');
    }
    const email = grant.teacher_email?.trim() ?? '';
    if (!email) {
      throw new ConflictException(
        'ครูคนนี้ยังไม่มีอีเมลสำหรับรับรหัส OTP กรุณาติดต่อผู้ดูแลโรงเรียน',
      );
    }

    const code = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = await this.otpStore.issue(otpKey(grant.id), code);
    const ttlMinutes = Math.max(1, Math.round((expiresAt.getTime() - Date.now()) / 60_000));
    await this.emailService.sendOTP(email, code, ttlMinutes);
    await this.auditLog.record({
      actorUserId: grant.teacher_user_id,
      actorLabel: grant.teacher_username,
      action: 'TEACHER_ACCESS_OTP_REQUEST',
      targetType: 'teacher_access_grants',
      targetId: grant.id,
      metadata: { schoolId: grant.school_id, teacherName: grant.teacher_display_name },
      ip: null,
    });
    return {
      success: true,
      data: {
        method: 'EMAIL' as const,
        maskedEmail: maskEmailAddress(email),
        expiresAt: expiresAt.toISOString(),
      },
    };
  }

  async verifyOtp(rawToken: string, code: string) {
    const grant = await this.findUsableGrantForVerification(rawToken);
    if (grant.step_up_policy !== 'EMAIL_OTP') {
      throw new BadRequestException('ลิงก์นี้ไม่ได้ใช้การยืนยันด้วยรหัส OTP');
    }
    const outcome = await this.otpStore.verify(otpKey(grant.id), code.trim());
    if (outcome !== 'ok') {
      await this.auditLog.record({
        actorUserId: grant.teacher_user_id,
        actorLabel: grant.teacher_username,
        action: 'TEACHER_ACCESS_OTP_FAILED',
        targetType: 'teacher_access_grants',
        targetId: grant.id,
        metadata: {
          schoolId: grant.school_id,
          teacherName: grant.teacher_display_name,
          outcome,
        },
        ip: null,
      });
    }
    if (outcome === 'locked') {
      throw new HttpException(
        'ลองรหัส OTP ผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่หรือลองอีกครั้งภายหลัง',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (outcome === 'missing' || outcome === 'expired') {
      throw new BadRequestException('รหัส OTP หมดอายุ กรุณาขอรหัสใหม่');
    }
    if (outcome === 'wrong') {
      throw new BadRequestException('รหัส OTP ไม่ถูกต้อง');
    }
    const sessionToken = await this.magicSessionStore.issue(grant.id);
    return { success: true, data: { sessionToken } };
  }

  async verifyAraId(rawToken: string, araIdProfileId: string) {
    const grant = await this.findUsableGrantForVerification(rawToken);
    if (grant.step_up_policy !== 'EMAIL_OTP' && grant.step_up_policy !== 'THAID') {
      throw new BadRequestException('ลิงก์นี้ไม่ได้ใช้การยืนยันตัวตนผ่าน AraID');
    }

    await this.assertAraIdIdentityMatchesGrant(grant, araIdProfileId);

    const sessionToken = await this.magicSessionStore.issue(grant.id);
    await this.auditLog.record({
      actorUserId: grant.teacher_user_id,
      actorLabel: grant.teacher_username,
      action: 'TEACHER_ACCESS_ARAID_VERIFY',
      targetType: 'teacher_access_grants',
      targetId: grant.id,
      metadata: { schoolId: grant.school_id, authMethod: 'ARAID' },
      ip: null,
    });
    return { success: true, data: { sessionToken } };
  }

  async createAraIdChallenge(rawToken: string, baseUrl: string) {
    const grant = await this.findUsableGrantForVerification(rawToken);
    if (grant.step_up_policy !== 'EMAIL_OTP' && grant.step_up_policy !== 'THAID') {
      throw new BadRequestException('ลิงก์นี้ไม่ได้ใช้การยืนยันตัวตนผ่าน AraID');
    }
    if (!/^\d{13}$/.test(grant.teacher_citizen_id?.trim() ?? '')) {
      throw new ConflictException('ครูเจ้าของลิงก์ยังไม่มีเลขบัตรประชาชนสำหรับยืนยันผ่าน AraID');
    }
    const challenge = await this.araIdChallengeStore.create(ARAID_SCOPE, grant.id);
    const verificationUrl = new URL('/araid/authorize', baseUrl);
    verificationUrl.hash = `challenge=${encodeURIComponent(challenge.token)}`;
    const qrDataUrl = await QRCode.toDataURL(verificationUrl.toString(), {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    return {
      success: true,
      data: {
        challengeToken: challenge.token,
        verificationUrl: verificationUrl.toString(),
        qrDataUrl,
        referenceCode: challenge.referenceCode,
        expiresAt: new Date(challenge.entryExpiresAt).toISOString(),
      },
    };
  }

  async beginAraIdChallenge(challengeToken: string, existingAuthorizationToken?: string) {
    if (existingAuthorizationToken) {
      const resumed = await this.araIdChallengeStore.resume(
        ARAID_SCOPE,
        challengeToken,
        existingAuthorizationToken,
      );
      if (resumed) {
        return {
          authorizationToken: resumed.authorizationToken,
          expiresAt: new Date(resumed.expiresAt),
        };
      }
    }
    const challenge = await this.araIdChallengeStore.read(ARAID_SCOPE, challengeToken);
    if (!challenge || challenge.status !== 'PENDING') {
      throw new GoneException('คำขอยืนยัน AraID ถูกเปิดใช้หรือหมดอายุแล้ว');
    }
    const authorization = await this.araIdChallengeStore.claim(ARAID_SCOPE, challengeToken);
    if (!authorization) throw new GoneException('คำขอยืนยัน AraID ถูกเปิดใช้หรือหมดอายุแล้ว');
    return {
      authorizationToken: authorization.authorizationToken,
      expiresAt: new Date(authorization.expiresAt),
    };
  }

  async approveAraIdChallenge(
    authorizationToken: string,
    araIdProfileId: string,
    authenticatedAt: number,
  ) {
    const authorization = await this.araIdChallengeStore.readAuthorization(
      ARAID_SCOPE,
      authorizationToken,
    );
    if (!authorization) throw new GoneException('การยืนยัน AraID หมดอายุแล้ว');
    if (authenticatedAt < authorization.minimumAuthenticatedAt) {
      throw new UnauthorizedException('กรุณากรอก PIN AraID ใหม่เพื่อยืนยันลิงก์ครู');
    }
    const grant = await this.repository.findGrantById(authorization.challenge.subjectId);
    if (!grant) throw new GoneException('ลิงก์เข้าใช้งานถูกเพิกถอนแล้ว');
    this.assertGrantUsable(grant);
    if (grant.step_up_policy !== 'EMAIL_OTP' && grant.step_up_policy !== 'THAID') {
      throw new BadRequestException('ลิงก์นี้ไม่ได้ใช้การยืนยันตัวตนผ่าน AraID');
    }
    await this.assertAraIdIdentityMatchesGrant(grant, araIdProfileId);
    if (!(await this.araIdChallengeStore.approveAuthorization(ARAID_SCOPE, authorizationToken))) {
      throw new GoneException('คำขอยืนยัน AraID ถูกใช้หรือหมดอายุแล้ว');
    }
    await this.auditLog.record({
      actorUserId: grant.teacher_user_id,
      actorLabel: grant.teacher_username,
      action: 'TEACHER_ACCESS_ARAID_VERIFY',
      targetType: 'teacher_access_grants',
      targetId: grant.id,
      metadata: { schoolId: grant.school_id, authMethod: 'ARAID_QR' },
      ip: null,
    });
    return { success: true, data: { approved: true } };
  }

  async pollAraIdChallenge(challengeToken: string) {
    const challenge = await this.araIdChallengeStore.read(ARAID_SCOPE, challengeToken);
    if (!challenge) throw new GoneException('คำขอยืนยัน AraID หมดอายุแล้ว');
    if (challenge.status === 'PENDING') {
      return { success: true, data: { status: 'PENDING' as const } };
    }
    if (challenge.status === 'CLAIMED') {
      return {
        success: true,
        data: {
          status: 'IN_PROGRESS' as const,
          expiresAt: new Date(challenge.expiresAt).toISOString(),
        },
      };
    }
    const consumed = await this.araIdChallengeStore.consumeApproved(ARAID_SCOPE, challengeToken);
    if (!consumed) throw new GoneException('คำขอยืนยัน AraID ถูกใช้แล้ว');
    const grant = await this.repository.findGrantById(consumed.subjectId);
    if (!grant) throw new GoneException('ลิงก์เข้าใช้งานถูกเพิกถอนแล้ว');
    this.assertGrantUsable(grant);
    const sessionToken = await this.magicSessionStore.issue(grant.id);
    return { success: true, data: { status: 'APPROVED' as const, sessionToken } };
  }

  private async assertAraIdIdentityMatchesGrant(
    grant: TeacherAccessGrantRow,
    araIdProfileId: string,
  ): Promise<void> {
    const expectedIdentityNumber = grant.teacher_citizen_id?.trim() ?? '';
    if (!/^\d{13}$/.test(expectedIdentityNumber)) {
      throw new ConflictException('ครูเจ้าของลิงก์ยังไม่มีเลขบัตรประชาชนสำหรับยืนยันผ่าน AraID');
    }
    const verifiedIdentityNumber =
      await this.araIdService.getVerifiedIdentityNumber(araIdProfileId);
    const expectedBuffer = Buffer.from(expectedIdentityNumber);
    const verifiedBuffer = Buffer.from(verifiedIdentityNumber);
    const matches =
      expectedBuffer.length === verifiedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, verifiedBuffer);
    if (matches) return;
    await this.auditLog.record({
      actorUserId: null,
      actorLabel: 'AraID',
      action: 'TEACHER_ACCESS_ARAID_FAILED',
      targetType: 'teacher_access_grants',
      targetId: grant.id,
      metadata: { schoolId: grant.school_id, reason: 'IDENTITY_MISMATCH' },
      ip: null,
    });
    throw new ForbiddenException('ข้อมูล AraID ไม่ตรงกับครูเจ้าของลิงก์');
  }

  async resolveActiveGrant(
    rawToken: string,
    capability: TeacherAccessCapability,
    assignmentId: number,
    studentUuid?: string,
    sessionToken?: string,
  ): Promise<ActiveTeacherGrantContext> {
    return await this.withActiveGrantContext(
      rawToken,
      { capability, assignmentId, studentUuid, sessionToken, operation: 'AUTHORIZE_DOMAIN_WRITE' },
      (context) => Promise.resolve(context),
    );
  }

  private async findAssignmentForGrantContext(
    context: ActiveTeacherGrantContext,
    assignmentId: number,
    queryRunner: QueryRunner,
  ): Promise<TeacherAccessAssignmentRow | null> {
    if (context.accessScope === 'ATTENDANCE_ONLY') {
      const assignment = await this.repository.findRestrictedAttendanceAssignment(
        context.grantId,
        queryRunner,
      );
      return assignment && Number(assignment.assignment_id) === assignmentId ? assignment : null;
    }
    return await this.repository.findGrantAssignment(context.grantId, assignmentId, queryRunner);
  }

  private assertAttendanceDateAllowed(context: ActiveTeacherGrantContext, date: string): void {
    if (context.accessScope === 'ATTENDANCE_ONLY' && context.attendanceDate !== date) {
      throw new ForbiddenException('ลิงก์นี้ใช้เช็กชื่อได้เฉพาะวันที่ได้รับมอบหมาย');
    }
  }

  async getPublicContext(rawToken: string, sessionToken?: string) {
    return await this.withActiveGrantContext(
      rawToken,
      { sessionToken, operation: 'VIEW_CONTEXT' },
      async (context, queryRunner) => {
        const assignments =
          context.accessScope === 'ATTENDANCE_ONLY'
            ? [
                await this.repository.findRestrictedAttendanceAssignment(
                  context.grantId,
                  queryRunner,
                ),
              ].filter(
                (assignment): assignment is TeacherAccessAssignmentRow => assignment !== null,
              )
            : await this.repository.listGrantAssignments(context.grantId, queryRunner);
        const activeAssignments = assignments.filter((row) => this.assignmentActiveToday(row));
        if (activeAssignments.length === 0) {
          throw new ForbiddenException('ลิงก์นี้ไม่มี assignment ที่เปิดใช้งาน');
        }
        return {
          data: {
            grantId: context.grantId,
            teacherDisplayName: context.teacherDisplayName,
            schoolId: context.schoolId,
            schoolName: context.schoolName,
            schoolTermId: context.schoolTermId,
            academicYear: context.academicYear,
            semester: context.semester,
            capabilities: context.capabilities,
            accessScope: context.accessScope,
            assignments: activeAssignments.map((row) =>
              this.toAssignment(row, context.capabilities),
            ),
          },
        };
      },
    );
  }

  async listPublicAttendanceSlots(
    rawToken: string,
    input: { assignmentId: number; date: string },
    sessionToken?: string,
  ) {
    return await this.withActiveGrantContext(
      rawToken,
      { assignmentId: input.assignmentId, sessionToken, operation: 'VIEW_ATTENDANCE_SLOTS' },
      async (context, queryRunner) => {
        this.assertAttendanceDateAllowed(context, input.date);
        const assignment = await this.findAssignmentForGrantContext(
          context,
          input.assignmentId,
          queryRunner,
        );
        if (!assignment) throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
        const capability = this.attendanceCapability(assignment.assignment_kind);
        if (!context.capabilities.includes(capability)) {
          throw new ForbiddenException('ลิงก์นี้ไม่มีสิทธิ์เช็กชื่อใน assignment นี้');
        }
        if (assignment.assignment_kind !== 'SUBJECT') return { data: [] };
        if (!assignment.subject_id) {
          throw new ConflictException('assignment รายวิชานี้ไม่มีรายวิชาที่ผูกไว้');
        }
        const slots = await this.repository.listAssignmentSlotsForDate(
          {
            classroomId: Number(assignment.classroom_id),
            subjectId: assignment.subject_id,
            teacherMembershipId: Number(assignment.teacher_membership_id),
            isoDayOfWeek: getIsoDayOfWeekFromDateString(input.date),
          },
          queryRunner,
        );
        return { data: slots.map((slot) => ({ id: Number(slot.id), period: slot.period })) };
      },
    );
  }

  async listPublicRoster(
    rawToken: string,
    assignmentId: number,
    searchTerm: string | undefined,
    pageInput?: number,
    limitInput?: number,
    sessionToken?: string,
  ) {
    const page = resolvePage(pageInput);
    const limit = resolveLimit(limitInput);
    return await this.withActiveGrantContext(
      rawToken,
      { assignmentId, sessionToken, operation: 'VIEW_ROSTER' },
      async (context, queryRunner) => {
        const assignment = await this.findAssignmentForGrantContext(
          context,
          assignmentId,
          queryRunner,
        );
        if (!assignment) throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
        const requiredCapability = this.attendanceCapability(assignment.assignment_kind);
        if (!context.capabilities.includes(requiredCapability)) {
          throw new ForbiddenException('ลิงก์นี้ไม่มี capability สำหรับ roster นี้');
        }
        const rows = await this.repository.listRoster(
          Number(assignment.classroom_id),
          searchTerm,
          page,
          limit,
          queryRunner,
        );
        return {
          data: rows.map((row) => ({
            studentUuid: row.student_uuid,
            studentTermId: row.student_uuid,
            studentNumber: row.student_number,
            hasPhoto: row.has_photo,
            firstName: row.first_name,
            lastName: row.last_name,
            studentStatusCode: row.student_status_code,
            studentStatusLabel: row.student_status_label,
            riskTier: row.risk_tier,
            teacherComment: row.teacher_comment,
          })),
          meta: buildPaginationMeta(page, limit, Number(rows[0]?.total_count ?? 0)),
        };
      },
    );
  }

  async resolvePublicStudentPhoto(
    rawToken: string,
    input: { assignmentId: number; studentUuid: string },
    sessionToken?: string,
  ): Promise<FileServeResult> {
    return await this.withActiveGrantContext(
      rawToken,
      {
        assignmentId: input.assignmentId,
        studentUuid: input.studentUuid,
        sessionToken,
        operation: 'VIEW_STUDENT_PHOTO',
        recordSuccessfulUse: false,
      },
      async (context) =>
        await this.studentsService.resolveStudentPhoto(
          input.studentUuid,
          this.grantActor(context),
          { school_ids: [context.schoolId] },
        ),
    );
  }

  /**
   * Subject attendance is recorded against a timetable period. The screen shows
   * one roster per class, so the period is resolved from the timetable when the
   * subject meets exactly once that day and only has to be chosen explicitly
   * when the class has several periods of the same subject.
   */
  private async resolveAttendanceSlotId(
    assignment: TeacherAccessAssignmentRow,
    dto: { date: string; timetableSlotId?: number },
    queryRunner: QueryRunner,
  ): Promise<number | undefined> {
    if (assignment.assignment_kind !== 'SUBJECT') return undefined;
    if (!assignment.subject_id) {
      throw new ConflictException('assignment รายวิชานี้ไม่มีรายวิชาที่ผูกไว้');
    }
    const slots = await this.repository.listAssignmentSlotsForDate(
      {
        classroomId: Number(assignment.classroom_id),
        subjectId: assignment.subject_id,
        teacherMembershipId: Number(assignment.teacher_membership_id),
        isoDayOfWeek: getIsoDayOfWeekFromDateString(dto.date),
      },
      queryRunner,
    );
    if (dto.timetableSlotId) {
      const chosen = slots.find((slot) => Number(slot.id) === dto.timetableSlotId);
      if (!chosen) throw new BadRequestException('คาบเรียนที่เลือกไม่ตรงกับวิชาและวันที่');
      return dto.timetableSlotId;
    }
    if (slots.length === 0) {
      throw new BadRequestException('วิชานี้ไม่มีคาบสอนในวันที่เลือก');
    }
    if (slots.length > 1) {
      throw new BadRequestException('วิชานี้มีหลายคาบในวันที่เลือก กรุณาระบุคาบที่ต้องการเช็กชื่อ');
    }
    return Number(slots[0].id);
  }

  /** Past attendance rounds of one class, for ประวัติการเช็กชื่อ. */
  /**
   * The staff history, seen through a link: same repository, same day verdict,
   * only scoped to the class the link opens and — for a subject card — to that
   * subject, which is exactly what the ระบบ screen shows when an admin picks
   * the same subject in its filter.
   */
  async listPublicAttendanceHistory(
    rawToken: string,
    query: {
      assignmentId: number;
      view?: 'DAILY' | 'STUDENT';
      studentUuid?: string;
      page?: number;
      limit?: number;
      search?: string;
      attendanceDate?: string;
      dateFrom?: string;
      dateTo?: string;
      sortBy?:
        | 'date'
        | 'time'
        | 'recordedBy'
        | 'studentNumber'
        | 'name'
        | 'status'
        | 'present'
        | 'late'
        | 'leave'
        | 'absent';
      sortOrder?: 'asc' | 'desc';
    },
    sessionToken?: string,
  ) {
    const page = resolvePage(query.page);
    const limit = resolveLimit(query.limit);
    const sortDirection = query.sortOrder === 'asc' ? 'asc' : 'desc';
    return await this.withActiveGrantContext(
      rawToken,
      { assignmentId: query.assignmentId, sessionToken, operation: 'VIEW_ATTENDANCE_HISTORY' },
      async (context, queryRunner) => {
        const assignment = await this.repository.findGrantAssignment(
          context.grantId,
          query.assignmentId,
          queryRunner,
        );
        if (!assignment) throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
        if (!context.capabilities.includes(this.attendanceCapability(assignment.assignment_kind))) {
          throw new ForbiddenException('ลิงก์นี้ไม่มีสิทธิ์ดูประวัติการเช็กชื่อของห้องนี้');
        }
        const classroomId = Number(assignment.classroom_id);
        const subjectId =
          assignment.assignment_kind === 'SUBJECT' ? Number(assignment.subject_id) : null;
        const search = query.search?.trim() || undefined;

        if (query.studentUuid) {
          const inRoster = await this.repository.isStudentInClassroom(
            query.studentUuid,
            classroomId,
            queryRunner,
          );
          if (!inRoster) throw new ForbiddenException('นักเรียนอยู่นอก roster ของ assignment');
          const days = await this.schoolStructure.listStudentAttendanceDays({
            classroomId,
            studentUuid: query.studentUuid,
            date: query.attendanceDate,
            dateFrom: query.dateFrom,
            dateTo: query.dateTo,
            search,
            sortBy:
              query.sortBy === 'time' || query.sortBy === 'recordedBy' || query.sortBy === 'status'
                ? query.sortBy
                : 'date',
            sortDirection,
            page,
            limit,
          });
          return {
            data: days.rows.map((row) => ({
              id: row.attendance_id,
              date: row.attendance_date,
              time: row.recorded_time,
              recordedBy: row.recorded_by,
              status: attendanceStatusFromCode(row.attendance_status),
            })),
            meta: buildPaginationMeta(page, limit, days.totalCount),
          };
        }

        if (query.view === 'STUDENT') {
          const students = await this.schoolStructure.listClassroomStudentAttendance({
            classroomId,
            subjectId,
            date: query.attendanceDate,
            search,
            sortBy:
              query.sortBy === 'studentNumber' ||
              query.sortBy === 'status' ||
              query.sortBy === 'present' ||
              query.sortBy === 'late' ||
              query.sortBy === 'leave' ||
              query.sortBy === 'absent' ||
              query.sortBy === 'name'
                ? query.sortBy
                : 'name',
            sortDirection: query.sortOrder === 'desc' ? 'desc' : 'asc',
            page,
            limit,
          });
          return {
            data: students.rows.map((row) => ({
              studentUuid: row.student_uuid,
              studentNumber: row.student_number,
              // The photo itself is fetched through the link's own photo route.
              hasPhoto: Boolean(row.photo_storage_key),
              firstName: row.first_name,
              lastName: row.last_name,
              presentCount: row.present_count,
              lateCount: row.late_count,
              leaveCount: row.leave_count,
              absentCount: row.absent_count,
            })),
            meta: buildPaginationMeta(page, limit, students.totalCount),
          };
        }

        const daily = await this.schoolStructure.listClassroomDailyAttendance({
          classroomId,
          subjectId,
          date: query.attendanceDate,
          search,
          sortBy:
            query.sortBy === 'recordedBy' ||
            query.sortBy === 'present' ||
            query.sortBy === 'late' ||
            query.sortBy === 'leave' ||
            query.sortBy === 'absent' ||
            query.sortBy === 'date'
              ? query.sortBy
              : 'date',
          sortDirection,
          page,
          limit,
        });
        return {
          data: daily.rows.map((row) => ({
            attendanceDate: row.attendance_date,
            recordedBy: row.recorded_by,
            presentCount: row.present_count,
            lateCount: row.late_count,
            leaveCount: row.leave_count,
            absentCount: row.absent_count,
          })),
          meta: buildPaginationMeta(page, limit, daily.totalCount),
        };
      },
    );
  }

  /**
   * Same audit gate the staff export goes through, recorded against the class
   * the link is scoped to instead of a permission-bearing account.
   */
  async recordPublicClassroomExport(
    rawToken: string,
    input: {
      assignmentId: number;
      exportScope: 'ROSTER' | 'ATTENDANCE';
      format: string;
      columns: string[];
      dateFrom?: string;
      dateTo?: string;
    },
    sessionToken?: string,
  ) {
    if (Boolean(input.dateFrom) !== Boolean(input.dateTo)) {
      throw new BadRequestException('ต้องระบุวันเริ่มและวันจบพร้อมกัน');
    }
    if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
      throw new BadRequestException('วันเริ่มต้องไม่เกินวันจบ');
    }
    return await this.withActiveGrantContext(
      rawToken,
      { assignmentId: input.assignmentId, sessionToken, operation: 'EXPORT_CLASSROOM_DATA' },
      async (context, queryRunner) => {
        if (!context.classroomId) throw new ForbiddenException('ไม่พบห้องเรียนใน assignment');
        await this.auditLog.recordAtomic(
          {
            actorUserId: context.teacherUserId,
            actorLabel: context.teacherUsername,
            action: 'CLASSROOM_DATA_EXPORT',
            targetType: 'school_classrooms',
            targetId: String(context.classroomId),
            metadata: {
              schoolId: context.schoolId,
              teacherName: context.teacherDisplayName,
              exportScope: input.exportScope,
              format: input.format,
              columns: input.columns,
              dateFrom: input.dateFrom ?? null,
              dateTo: input.dateTo ?? null,
              via: 'TEACHER_LINK',
            },
            ip: null,
          },
          queryRunner,
        );
        return { success: true };
      },
    );
  }

  /** Writes the หมายเหตุ shown on both the teacher and the staff roster. */
  async createPublicStudentComment(
    rawToken: string,
    input: { assignmentId: number; studentUuid: string; commentText: string },
    sessionToken?: string,
  ) {
    return await this.withActiveGrantContext(
      rawToken,
      {
        assignmentId: input.assignmentId,
        studentUuid: input.studentUuid,
        sessionToken,
        operation: 'CREATE_STUDENT_COMMENT',
      },
      async (context, queryRunner) => {
        if (!context.classroomId) throw new ForbiddenException('ไม่พบห้องเรียนใน assignment');
        const created = await this.repository.createStudentComment(
          {
            classroomId: Number(context.classroomId),
            studentUuid: input.studentUuid,
            commentText: input.commentText,
            authoredByUserId: context.teacherUserId,
          },
          queryRunner,
        );
        if (!created) throw new NotFoundException('ไม่พบนักเรียนในห้องเรียนนี้');
        // Same trigger as the staff path: a teacher comment is what makes a
        // student เฝ้าระวัง, so the profile is recalculated right away.
        await this.riskProfileService
          .requestStudentRecalculation([input.studentUuid], 'classroom-comment')
          .catch(() => {
            this.logger.warn(`Unable to refresh risk profile for student ${input.studentUuid}`);
          });
        return { data: { id: created.id, commentText: created.comment_text } };
      },
    );
  }

  /**
   * Card personalisation from the teacher view — colour, cover image and its
   * framing, exactly like the staff screen. The card lives on the shared
   * classroom row, so it is limited to classes inside the link and audited.
   */
  async updatePublicClassroomPresentation(
    rawToken: string,
    input: {
      assignmentId: number;
      cardCoverColor?: string;
      coverImagePositionX?: number;
      coverImagePositionY?: number;
      coverImageScale?: number;
      removeCover?: boolean;
    },
    file: Express.Multer.File | undefined,
    sessionToken?: string,
  ) {
    if (file && input.removeCover) {
      throw new BadRequestException('ไม่สามารถอัปโหลดและนำรูปออกพร้อมกันได้');
    }
    let newStorageKey: string | undefined;
    let replacedStorageKey: string | null = null;
    let classroomIdForCleanup: number | null = null;
    try {
      const authorizedClassroomId = file
        ? await this.withActiveGrantContext(
            rawToken,
            {
              assignmentId: input.assignmentId,
              sessionToken,
              operation: 'AUTHORIZE_CLASSROOM_CARD_UPDATE',
              recordSuccessfulUse: false,
            },
            (context) => {
              if (!context.classroomId) {
                throw new ForbiddenException('ไม่พบห้องเรียนใน assignment');
              }
              return Promise.resolve(Number(context.classroomId));
            },
          )
        : null;
      classroomIdForCleanup = authorizedClassroomId;

      // Image work is deliberately outside the grant-row transaction. The
      // grant and assignment are rechecked below before the storage key is
      // persisted, and a failed recheck deletes this otherwise-unused object.
      newStorageKey = file
        ? await processImageUpload(file, this.storage, 'classroom-covers')
        : undefined;

      const result = await this.withActiveGrantContext(
        rawToken,
        { assignmentId: input.assignmentId, sessionToken, operation: 'UPDATE_CLASSROOM_CARD' },
        async (context, queryRunner) => {
          if (!context.classroomId) throw new ForbiddenException('ไม่พบห้องเรียนใน assignment');
          const classroomId = Number(context.classroomId);
          if (authorizedClassroomId !== null && classroomId !== authorizedClassroomId) {
            throw new ForbiddenException('assignment เปลี่ยนแปลงระหว่างอัปเดตห้องเรียน');
          }
          classroomIdForCleanup = classroomId;
          const current = await this.repository.findClassroomPresentation(classroomId, queryRunner);
          if (!current) throw new NotFoundException('ไม่พบห้องเรียน');
          replacedStorageKey = current.cover_image_storage_key;
          const coverImageStorageKey =
            newStorageKey !== undefined
              ? newStorageKey
              : input.removeCover
                ? null
                : current.cover_image_storage_key;
          const cardCoverColor = input.cardCoverColor ?? current.card_cover_color;
          const coverImagePositionX = input.coverImagePositionX ?? current.cover_image_position_x;
          const coverImagePositionY = input.coverImagePositionY ?? current.cover_image_position_y;
          const coverImageScale = input.coverImageScale ?? Number(current.cover_image_scale);
          await this.repository.updateClassroomPresentation(
            {
              classroomId,
              cardCoverColor,
              coverImageStorageKey,
              coverImagePositionX,
              coverImagePositionY,
              coverImageScale,
              actorUserId: context.teacherUserId,
            },
            queryRunner,
          );
          return {
            data: {
              classroomId: context.classroomId,
              cardCoverColor,
              hasCoverImage: coverImageStorageKey !== null,
              coverImagePositionX,
              coverImagePositionY,
              coverImageScale,
            },
          };
        },
      );
      if ((newStorageKey || input.removeCover) && replacedStorageKey) {
        await this.storage.delete(replacedStorageKey).catch(() => {
          this.logger.warn(
            `Unable to delete replaced teacher classroom cover for classroom ${classroomIdForCleanup ?? 'unknown'}`,
          );
        });
      }
      return result;
    } catch (error) {
      if (newStorageKey) {
        await this.storage.delete(newStorageKey).catch(() => {
          this.logger.warn(
            `Unable to delete unused teacher classroom cover for classroom ${classroomIdForCleanup ?? 'unknown'}`,
          );
        });
      }
      throw error;
    }
  }

  /**
   * The link already carries a real teacher identity (membership → account,
   * school, term and the exact classes they teach), so student reads run through
   * the ordinary student services with an actor built from the grant instead of
   * a duplicated set of guest queries. The permission set is the read-only
   * minimum those services check, and the scope is the link's own school — the
   * roster check in `withActiveGrantContext` already proved the student sits in
   * a class this link covers.
   */
  private grantActor(context: ActiveTeacherGrantContext): AuthenticatedRequestUser {
    return {
      // Teachers created without a login account have no user_id; the real
      // identity is the grant + teacherUsername captured in audit metadata.
      id: context.teacherUserId ?? 0,
      teacher_membership_id: Number(context.teacherMembershipId),
      username: context.teacherUsername,
      roles: ['TEACHER'],
      permissions: ['students', 'student-observations'],
      data_scope: { school_ids: [context.schoolId] },
    };
  }

  /** Everything the student profile screen renders, in one grant-scoped read. */
  async getPublicStudentProfile(
    rawToken: string,
    input: { assignmentId: number; studentUuid: string },
    sessionToken?: string,
  ) {
    return await this.withActiveGrantContext(
      rawToken,
      {
        assignmentId: input.assignmentId,
        studentUuid: input.studentUuid,
        sessionToken,
        operation: 'VIEW_STUDENT_PROFILE',
      },
      async (context) => {
        const actor = this.grantActor(context);
        const scope = { school_ids: [context.schoolId] };
        const [student, summary, cases, attendance, observations, comments] = await Promise.all([
          this.studentsService.findOne(input.studentUuid, actor, scope),
          this.studentsService.getStudentProfileSummary(input.studentUuid, actor, scope),
          this.studentsService.findCasesByStudentId(input.studentUuid, actor, scope),
          this.studentsService.findAttendanceByStudentId(input.studentUuid, actor, scope),
          this.studentObservations.list(input.studentUuid, { page: 1, limit: 20 }, actor),
          // The comment button on the roster writes a classroom comment, so the
          // profile has to read those too or a teacher's own note goes missing.
          context.classroomId
            ? this.repository.listStudentComments({
                classroomId: Number(context.classroomId),
                studentUuid: input.studentUuid,
                limit: 20,
              })
            : Promise.resolve([]),
        ]);
        // getStudentProfileSummary answers the staff endpoint, so it ships its
        // own { success, data } envelope — unwrap it before nesting, otherwise
        // the profile screen reads summary.attendance off the envelope.
        return {
          data: {
            student,
            summary: summary.data,
            cases,
            attendance,
            observations,
            comments: comments.map((comment) => ({
              id: comment.id,
              commentText: comment.comment_text,
              authorName: comment.author_name,
              createdAt: new Date(comment.created_at).toISOString(),
            })),
          },
        };
      },
    );
  }

  /**
   * The link holder's own teaching periods, read-only. Slots and the school's
   * bell schedule travel together because the grid needs both to place a period
   * on a time row, and a link cannot call the two authenticated endpoints.
   */
  async getPublicTeacherSchedule(rawToken: string, sessionToken?: string) {
    return await this.withActiveGrantContext(
      rawToken,
      { sessionToken, operation: 'VIEW_MY_TIMETABLE' },
      async (context) => {
        const actor = this.grantActor(context);
        const [schedule, periodTimes] = await Promise.all([
          this.timetableService.getMySchedule(actor, { mine: true }),
          this.timetableService.listPeriodTimes(actor, context.schoolId),
        ]);
        return { data: { slots: schedule.data, periodTimes: periodTimes.data } };
      },
    );
  }

  /** Per-day subject breakdown behind the profile calendar. */
  async getPublicStudentSubjectAttendance(
    rawToken: string,
    input: { assignmentId: number; studentUuid: string; date: string },
    sessionToken?: string,
  ) {
    return await this.withActiveGrantContext(
      rawToken,
      {
        assignmentId: input.assignmentId,
        studentUuid: input.studentUuid,
        sessionToken,
        operation: 'VIEW_STUDENT_SUBJECT_ATTENDANCE',
      },
      async (context) =>
        await this.studentsService.getStudentSubjectAttendance(
          input.studentUuid,
          input.date,
          this.grantActor(context),
          { school_ids: [context.schoolId] },
        ),
    );
  }

  /** Serves the class cover to the teacher who holds the link. */
  async resolvePublicClassroomCover(
    rawToken: string,
    assignmentId: number,
    sessionToken?: string,
  ): Promise<FileServeResult> {
    return await this.withActiveGrantContext(
      rawToken,
      { assignmentId, sessionToken, operation: 'VIEW_CLASSROOM_COVER' },
      async (context, queryRunner) => {
        if (!context.classroomId) throw new ForbiddenException('ไม่พบห้องเรียนใน assignment');
        const presentation = await this.repository.findClassroomPresentation(
          Number(context.classroomId),
          queryRunner,
        );
        if (!presentation?.cover_image_storage_key) {
          throw new NotFoundException('ไม่พบรูปห้องเรียน');
        }
        const result = await this.storage.resolve(presentation.cover_image_storage_key);
        if (!result) throw new NotFoundException('ไม่พบรูปห้องเรียน');
        return result;
      },
    );
  }

  /**
   * Reads an attendance spreadsheet for a teacher-link check-in. The grant is
   * authorized first and the parse runs *outside* that transaction on purpose:
   * a URL import performs an external HTTP request, which must not hold the
   * grant row lock (and a database connection) while it waits.
   */
  async parsePublicAttendanceImport(
    rawToken: string,
    dto: ParsePublicAttendanceImportDto,
    file: Express.Multer.File | undefined,
    sessionToken?: string,
  ) {
    if (!file && !dto.url) {
      throw new BadRequestException('กรุณาเลือกไฟล์หรือใส่ลิงก์');
    }
    await this.withActiveGrantContext(
      rawToken,
      {
        assignmentId: dto.assignmentId,
        sessionToken,
        operation: 'PARSE_ATTENDANCE_IMPORT',
        recordSuccessfulUse: false,
      },
      () => Promise.resolve(true),
    );

    return {
      data: file
        ? this.attendanceImport.parseUpload(file)
        : await this.attendanceImport.parseUrl(dto.url as string),
    };
  }

  /**
   * Autosave for a teacher-link check-in in progress. Same capability, same
   * assignment and same roster bound as the final submit — the only difference
   * is that this may carry part of the class and does not close the round.
   */
  async savePublicAttendanceMarks(
    rawToken: string,
    dto: SaveTeacherAccessAttendanceMarksDto,
    sessionToken?: string,
  ) {
    if (dto.date > getBangkokDateString()) {
      throw new BadRequestException('ไม่สามารถเช็กชื่อล่วงหน้าได้');
    }
    // Same envelope as savePublicAttendance so the two write paths look alike
    // to the client.
    const data = await this.withActiveGrantContext(
      rawToken,
      {
        assignmentId: dto.assignmentId,
        sessionToken,
        operation: 'SUBMIT_ATTENDANCE_DRAFT',
        recordSuccessfulUse: false,
      },
      async (context, queryRunner) => {
        this.assertAttendanceDateAllowed(context, dto.date);
        if (!context.classroomId) throw new ForbiddenException('ไม่พบห้องเรียนใน assignment');
        const assignment = await this.findAssignmentForGrantContext(
          context,
          dto.assignmentId,
          queryRunner,
        );
        if (!assignment) throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
        const capability = this.attendanceCapability(assignment.assignment_kind);
        if (!context.capabilities.includes(capability)) {
          throw new ForbiddenException('ลิงก์นี้ไม่มีสิทธิ์เช็กชื่อใน assignment นี้');
        }
        const timetableSlotId = await this.resolveAttendanceSlotId(assignment, dto, queryRunner);
        const allowedStudentIds = await this.repository.listRosterIds(
          Number(context.classroomId),
          queryRunner,
        );
        return await this.attendanceWriteService.saveDraftMarksWithinTransaction(
          (dto.records ?? []).map((record) => ({
            student_id: record.studentId,
            status: record.status,
            marked_at: record.markedAt ?? null,
          })),
          {
            actorUserId: context.teacherUserId,
            actorLabel: context.teacherUsername,
            recorder: context.teacherUsername,
            allowedStudentIds,
          },
          createSqlQueryExecutor(queryRunner),
          undefined,
          timetableSlotId,
          dto.date,
          dto.clearedStudentIds ?? [],
        );
      },
    );
    return { success: true, data };
  }

  /**
   * Session state plus the marks already stored, so the teacher-link page can
   * prefill what was checked earlier and lock itself once the round is
   * submitted — the authenticated page has had both since day one.
   */
  async getPublicAttendanceSession(
    rawToken: string,
    query: {
      assignmentId: number;
      date: string;
      timetableSlotId?: number;
      preflightOnly?: boolean;
    },
    sessionToken?: string,
  ) {
    return await this.withActiveGrantContext(
      rawToken,
      {
        assignmentId: query.assignmentId,
        sessionToken,
        operation: 'VIEW_ATTENDANCE_DRAFT',
        recordSuccessfulUse: false,
      },
      async (context, queryRunner) => {
        this.assertAttendanceDateAllowed(context, query.date);
        if (!context.classroomId) throw new ForbiddenException('ไม่พบห้องเรียนใน assignment');
        const assignment = await this.findAssignmentForGrantContext(
          context,
          query.assignmentId,
          queryRunner,
        );
        if (!assignment) throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
        if (!context.capabilities.includes(this.attendanceCapability(assignment.assignment_kind))) {
          throw new ForbiddenException('ลิงก์นี้ไม่มีสิทธิ์ดูรอบเช็กชื่อของห้องนี้');
        }
        const classroomId = Number(context.classroomId);
        if (assignment.legacy_room_number === null) {
          throw new ConflictException('ห้องเรียนนี้ยังไม่มีเลขห้องสำหรับตรวจสอบปฏิทิน');
        }
        const calendar = await this.attendanceWriteService.getCalendarAvailabilityForClassroom({
          schoolId: assignment.school_id,
          gradeLabel: assignment.grade_label,
          roomNo: assignment.legacy_room_number,
          date: query.date,
        });
        if (query.preflightOnly) return { data: { calendar } };
        const sessionKind = assignment.assignment_kind === 'SUBJECT' ? 'SUBJECT' : 'DAILY';
        // A subject class with several periods a day needs the caller to say
        // which one; resolveAttendanceSlotId raises the same errors the write
        // path does, so read and write agree on what "this round" means.
        const timetableSlotId =
          sessionKind === 'SUBJECT'
            ? ((await this.resolveAttendanceSlotId(assignment, query, queryRunner)) ?? null)
            : null;
        const roster = await this.repository.listRosterIds(classroomId, queryRunner);
        const session = await this.repository.findAttendanceSessionForClassroom(
          {
            classroomId,
            attendanceDate: query.date,
            sessionKind,
            timetableSlotId,
          },
          queryRunner,
        );
        const marks = session
          ? await this.repository.listAttendanceMarksForSession(session.id, queryRunner)
          : [];
        return {
          data: {
            calendar,
            expectedRosterCount: roster.length,
            session: session
              ? {
                  id: session.id,
                  status: session.status,
                  revision: Number(session.revision),
                  expectedRosterCount: Number(session.expected_roster_count),
                  recordedCount: Number(session.recorded_count),
                  submittedAt: session.submitted_at,
                  correctionReason: session.correction_reason,
                }
              : null,
            marks: marks.map((row) => ({
              studentUuid: row.student_uuid,
              status: attendanceStatusFromCode(row.status_code),
              markedAt: row.marked_at,
            })),
          },
        };
      },
    );
  }

  async savePublicAttendance(
    rawToken: string,
    dto: SaveTeacherAccessAttendanceDto,
    sessionToken?: string,
  ) {
    if (dto.date > getBangkokDateString()) {
      throw new BadRequestException('ไม่สามารถเช็กชื่อล่วงหน้าได้');
    }
    let affectedStudentIds: string[] = [];
    let calendarConfigured = false;
    const data = await this.withActiveGrantContext(
      rawToken,
      {
        assignmentId: dto.assignmentId,
        sessionToken,
        operation: 'SUBMIT_ATTENDANCE',
      },
      async (context, queryRunner) => {
        this.assertAttendanceDateAllowed(context, dto.date);
        if (!context.classroomId) throw new ForbiddenException('ไม่พบห้องเรียนใน assignment');
        const assignment = await this.findAssignmentForGrantContext(
          context,
          dto.assignmentId,
          queryRunner,
        );
        if (!assignment) throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
        const capability = this.attendanceCapability(assignment.assignment_kind);
        if (!context.capabilities.includes(capability)) {
          throw new ForbiddenException('ลิงก์นี้ไม่มีสิทธิ์เช็กชื่อใน assignment นี้');
        }
        const timetableSlotId = await this.resolveAttendanceSlotId(assignment, dto, queryRunner);
        const allowedStudentIds = await this.repository.listRosterIds(
          Number(context.classroomId),
          queryRunner,
        );
        const result = await this.attendanceWriteService.saveAttendanceWithinTransaction(
          dto.records.map((record) => ({
            student_id: record.studentId,
            status: record.status,
            marked_at: record.markedAt ?? null,
          })),
          {
            actorUserId: context.teacherUserId,
            actorLabel: context.teacherUsername,
            recorder: context.teacherUsername,
            allowedStudentIds,
          },
          createSqlQueryExecutor(queryRunner),
          undefined,
          timetableSlotId,
          dto.date,
        );
        affectedStudentIds = result.affectedStudentIds;
        calendarConfigured = result.calendarConfigured;
        return { session: result.session, calendarConfigured: result.calendarConfigured };
      },
    );

    await this.riskProfileService
      .requestStudentRecalculation(affectedStudentIds, 'teacher-access-attendance-save')
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to enqueue teacher-link attendance risk recalculation: ${message}`,
        );
      });
    const triggerType = await this.repository.getAlertTriggerType();
    if (triggerType === 'IMMEDIATE' && calendarConfigured) {
      this.automationService.checkConsecutiveAbsences().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Teacher-link immediate absence check failed: ${message}`);
      });
    }
    return { success: true, data };
  }
}
