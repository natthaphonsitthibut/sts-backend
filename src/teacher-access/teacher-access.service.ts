import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
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
import { AuditLogService } from '../audit-log/audit-log.service';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { generateToken, hashToken } from '../common/utils/helpers';
import { getBangkokDateString } from '../common/utils/date.util';
import { AutomationService } from '../automation/automation.service';
import { RiskProfileService } from '../risk-profile/risk-profile.service';
import { AttendanceWriteService } from '../attendance/attendance-write.service';
import { createSqlQueryExecutor } from '../database/sql-query';
import {
  TEACHER_ACCESS_LINK_PATH,
  TEACHER_ACCESS_EXPIRY_POLICIES,
  TEACHER_ACCESS_SETTING_KEYS,
  TEACHER_ACCESS_STEP_UP_POLICIES,
  type TeacherAccessExpiryPolicy,
  type TeacherAccessStepUpPolicy,
  type TeacherAccessCapability,
} from './teacher-access.constants';
import type {
  IssueTeacherAccessGrantDto,
  ListTeacherAccessGrantsDto,
  SaveTeacherAccessAttendanceDto,
} from './dto/teacher-access.dto';
import { TeacherAccessRepository } from './teacher-access.repository';
import type {
  ActiveTeacherGrantContext,
  TeacherAccessAssignmentRow,
  TeacherAccessGrantDetail,
  TeacherAccessGrantRow,
} from './teacher-access.types';

interface ActiveGrantOperationOptions {
  capability?: TeacherAccessCapability;
  assignmentId?: number;
  studentUuid?: string;
  operation: string;
}

@Injectable()
export class TeacherAccessService {
  private readonly logger = new Logger(TeacherAccessService.name);

  constructor(
    private readonly repository: TeacherAccessRepository,
    private readonly auditLog: AuditLogService,
    private readonly attendanceWriteService: AttendanceWriteService,
    private readonly automationService: AutomationService,
    private readonly riskProfileService: RiskProfileService,
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
    if (row.assignment_kind === 'HOMEROOM' && capabilities.includes('HOMEROOM_ATTENDANCE')) {
      allowedActions.push('HOMEROOM_ATTENDANCE');
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
      assignmentKind: row.assignment_kind,
      subjectId: row.subject_id,
      subjectCode: row.subject_code,
      subjectName: row.subject_name,
      effectiveOn: row.effective_on,
      effectiveUntil: row.effective_until,
      allowedActions,
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

  private parseExpiryPolicy(value: string | null): TeacherAccessExpiryPolicy {
    if (!value || !TEACHER_ACCESS_EXPIRY_POLICIES.includes(value as TeacherAccessExpiryPolicy)) {
      throw new ConflictException('การตั้งค่านโยบายวันหมดอายุของลิงก์ครูไม่ถูกต้อง');
    }
    return value as TeacherAccessExpiryPolicy;
  }

  private parseStepUpPolicy(value: string | null): TeacherAccessStepUpPolicy {
    if (!value || !TEACHER_ACCESS_STEP_UP_POLICIES.includes(value as TeacherAccessStepUpPolicy)) {
      throw new ConflictException('การตั้งค่านโยบายยืนยันตัวตนของลิงก์ครูไม่ถูกต้อง');
    }
    if (value !== 'NONE') {
      throw new ConflictException('นโยบายยืนยันตัวตนที่ตั้งไว้ยังไม่รองรับการใช้งาน');
    }
    return value;
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

  private assertIssueAssignments(
    detail: { schoolId: number; termId: number; membershipId: number },
    assignments: TeacherAccessAssignmentRow[],
    capabilities: TeacherAccessCapability[],
    expectedCount: number,
  ): void {
    if (assignments.length !== expectedCount) {
      throw new BadRequestException('ไม่พบ assignment บางรายการ');
    }
    for (const assignment of assignments) {
      if (
        assignment.school_id !== detail.schoolId ||
        Number(assignment.school_term_id) !== detail.termId ||
        Number(assignment.teacher_membership_id) !== detail.membershipId
      ) {
        throw new BadRequestException('assignment ไม่ตรงกับครู โรงเรียน หรือภาคเรียนที่เลือก');
      }
      if (!this.assignmentActiveToday(assignment)) {
        throw new BadRequestException('assignment บางรายการไม่ได้เปิดใช้งานในปัจจุบัน');
      }
      if (
        assignment.assignment_kind === 'HOMEROOM' &&
        !capabilities.includes('HOMEROOM_ATTENDANCE')
      ) {
        throw new BadRequestException('assignment ครูประจำห้องต้องมีสิทธิ์เช็คชื่อ');
      }
      if (
        assignment.assignment_kind === 'SUBJECT' &&
        !capabilities.includes('TEACHER_OBSERVATION')
      ) {
        throw new BadRequestException('assignment รายวิชาต้องมีสิทธิ์บันทึกข้อสังเกต');
      }
    }
    if (
      capabilities.includes('HOMEROOM_ATTENDANCE') &&
      !assignments.some((assignment) => assignment.assignment_kind === 'HOMEROOM')
    ) {
      throw new BadRequestException('สิทธิ์เช็คชื่อต้องมี assignment ครูประจำห้อง');
    }
    if (
      capabilities.includes('TEACHER_OBSERVATION') &&
      !assignments.some((assignment) => assignment.assignment_kind === 'SUBJECT')
    ) {
      throw new BadRequestException('สิทธิ์บันทึกข้อสังเกตต้องมี assignment รายวิชา');
    }
  }

  async issueGrant(
    dto: IssueTeacherAccessGrantDto,
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    const rawToken = generateToken();
    const tokenHash = hashToken(rawToken);
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้ออกลิงก์');

    const result = await this.repository.withTransaction(async (queryRunner) => {
      const term = await this.repository.findTermForIssue(dto.schoolTermId, queryRunner);
      if (!term) throw new NotFoundException('ไม่พบภาคเรียน');
      await this.assertSchoolAccess(term.school_id, actor);
      if (term.status !== 'ACTIVE') {
        throw new ConflictException('ออกลิงก์ได้เฉพาะภาคเรียนที่เปิดใช้งาน');
      }
      if (!term.ends_on) {
        throw new ConflictException('ภาคเรียนต้องกำหนดวันสิ้นสุดก่อนออกลิงก์');
      }
      const termExpiry = this.resolveTermExpiry(term.ends_on);

      const membership = await this.repository.findMembershipForIssue(
        dto.teacherMembershipId,
        queryRunner,
      );
      if (
        !membership ||
        membership.membership_status !== 'ACTIVE' ||
        membership.teacher_status !== 'ACTIVE'
      ) {
        throw new BadRequestException('ครูไม่ได้อยู่ในรายชื่อครูที่เปิดใช้งาน');
      }
      if (membership.school_id !== term.school_id) {
        throw new BadRequestException('ครูและภาคเรียนต้องอยู่โรงเรียนเดียวกัน');
      }
      const assignments = await this.repository.listAssignmentsForIssue(
        dto.assignmentIds,
        queryRunner,
      );
      this.assertIssueAssignments(
        {
          schoolId: term.school_id,
          termId: dto.schoolTermId,
          membershipId: dto.teacherMembershipId,
        },
        assignments,
        dto.capabilities,
        dto.assignmentIds.length,
      );

      const expiryPolicy = this.parseExpiryPolicy(
        await this.repository.getSystemSettingValue(
          TEACHER_ACCESS_SETTING_KEYS.expiryPolicy,
          queryRunner,
        ),
      );
      const stepUpPolicy = this.parseStepUpPolicy(
        await this.repository.getSystemSettingValue(
          TEACHER_ACCESS_SETTING_KEYS.stepUpPolicy,
          queryRunner,
        ),
      );
      const defaultExpiry = this.resolveDefaultExpiry(expiryPolicy, termExpiry, assignments);
      const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : defaultExpiry;
      if (expiresAt.getTime() <= Date.now()) {
        throw new BadRequestException('วันหมดอายุต้องอยู่ในอนาคต');
      }
      if (expiresAt.getTime() > termExpiry.getTime()) {
        throw new BadRequestException('ลิงก์ต้องไม่หมดอายุหลังสิ้นสุดภาคเรียน');
      }

      const grantId = await this.repository.createGrant(
        {
          teacherMembershipId: dto.teacherMembershipId,
          schoolId: term.school_id,
          schoolTermId: dto.schoolTermId,
          tokenHash,
          stepUpPolicy,
          issuedBy: actorId,
          expiresAt,
          capabilities: dto.capabilities,
          assignmentIds: dto.assignmentIds,
        },
        queryRunner,
      );
      const detail = await this.repository.getGrantDetail(grantId, queryRunner);
      if (!detail) throw new ConflictException('สร้างลิงก์ไม่สำเร็จ');
      await this.auditLog.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'TEACHER_ACCESS_GRANT_ISSUE',
          targetType: 'teacher_access_grants',
          targetId: grantId,
          metadata: {
            schoolId: term.school_id,
            schoolName: detail.grant.school_name,
            teacherName: detail.grant.teacher_display_name,
            teacherMembershipId: dto.teacherMembershipId,
            schoolTermId: dto.schoolTermId,
            assignmentIds: dto.assignmentIds,
            capabilities: dto.capabilities,
            expiresAt: expiresAt.toISOString(),
          },
          ip: null,
        },
        queryRunner,
      );
      return detail;
    });

    return {
      data: {
        ...this.toGrant(result.grant),
        assignments: result.assignments.map((row) => this.toAssignment(row, result.capabilities)),
        accessUrl: this.buildAccessUrl(baseUrl, rawToken),
      },
    };
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
      ...input,
      onDate: getBangkokDateString(),
    });
    return {
      data: rows.map((row) =>
        this.toAssignment(row, ['HOMEROOM_ATTENDANCE', 'TEACHER_OBSERVATION']),
      ),
    };
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

  async revokeGrant(grantId: string, reason: string, actor: AuthenticatedRequestUser) {
    const actorId = resolveAuditActorId(actor);
    if (actorId === null) throw new ForbiddenException('ไม่พบผู้ใช้ยกเลิกลิงก์');
    const detail = await this.repository.withTransaction(async (queryRunner) => {
      const current = await this.repository.getGrantDetail(grantId, queryRunner, true);
      if (!current) throw new NotFoundException('ไม่พบลิงก์เข้าใช้งานครู');
      await this.assertSchoolAccess(current.grant.school_id, actor);
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
      if (this.grantStatus(current.grant) !== 'ACTIVE') {
        throw new ConflictException('หมุนได้เฉพาะลิงก์ที่เปิดใช้งาน');
      }
      await this.repository.rotateGrantToken(grantId, tokenHash, queryRunner);
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
    if (grant.revoked_at) throw new GoneException('ลิงก์นี้ถูกยกเลิกแล้ว');
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
    if (grant.step_up_policy !== 'NONE') {
      throw new ForbiddenException('ลิงก์นี้ต้องยืนยันตัวตนเพิ่มเติม');
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
      assignment.teacher_membership_id !== grant.teacher_membership_id
    ) {
      throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
    }
    if (!this.assignmentActiveToday(assignment)) {
      throw new ForbiddenException('assignment นี้ไม่ได้เปิดใช้งาน');
    }
    if (capability === 'HOMEROOM_ATTENDANCE' && assignment.assignment_kind !== 'HOMEROOM') {
      throw new ForbiddenException('ลิงก์นี้ไม่มีสิทธิ์เช็คชื่อใน assignment นี้');
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
      schoolId: detail.grant.school_id,
      schoolName: detail.grant.school_name,
      schoolTermId: detail.grant.school_term_id,
      academicYear: detail.grant.academic_year,
      semester: detail.grant.semester,
      assignmentId: assignment?.assignment_id ?? null,
      classroomId: assignment?.classroom_id ?? null,
      subjectId: assignment?.subject_id ?? null,
      capabilities: detail.capabilities,
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
        const capabilities = await this.repository.listCapabilities(grant.id, queryRunner);
        if (options.capability && !capabilities.includes(options.capability)) {
          throw new ForbiddenException('ลิงก์นี้ไม่มี capability ที่ร้องขอ');
        }
        const assignment = options.assignmentId
          ? await this.repository.findGrantAssignment(grant.id, options.assignmentId, queryRunner)
          : null;
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

  async resolveActiveGrant(
    rawToken: string,
    capability: TeacherAccessCapability,
    assignmentId: number,
    studentUuid?: string,
  ): Promise<ActiveTeacherGrantContext> {
    return await this.withActiveGrantContext(
      rawToken,
      { capability, assignmentId, studentUuid, operation: 'AUTHORIZE_DOMAIN_WRITE' },
      (context) => Promise.resolve(context),
    );
  }

  async getPublicContext(rawToken: string) {
    return await this.withActiveGrantContext(
      rawToken,
      { operation: 'VIEW_CONTEXT' },
      async (context, queryRunner) => {
        const assignments = await this.repository.listGrantAssignments(
          context.grantId,
          queryRunner,
        );
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
            assignments: activeAssignments.map((row) =>
              this.toAssignment(row, context.capabilities),
            ),
          },
        };
      },
    );
  }

  async listPublicRoster(
    rawToken: string,
    assignmentId: number,
    searchTerm: string | undefined,
    pageInput?: number,
    limitInput?: number,
  ) {
    const page = resolvePage(pageInput);
    const limit = resolveLimit(limitInput);
    return await this.withActiveGrantContext(
      rawToken,
      { assignmentId, operation: 'VIEW_ROSTER' },
      async (context, queryRunner) => {
        const assignment = await this.repository.findGrantAssignment(
          context.grantId,
          assignmentId,
          queryRunner,
        );
        if (!assignment) throw new ForbiddenException('assignment อยู่นอกขอบเขตของลิงก์');
        const requiredCapability =
          assignment.assignment_kind === 'HOMEROOM' ? 'HOMEROOM_ATTENDANCE' : 'TEACHER_OBSERVATION';
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
            firstName: row.first_name,
            lastName: row.last_name,
            studentStatusCode: row.student_status_code,
            studentStatusLabel: row.student_status_label,
          })),
          meta: buildPaginationMeta(page, limit, Number(rows[0]?.total_count ?? 0)),
        };
      },
    );
  }

  async savePublicAttendance(rawToken: string, dto: SaveTeacherAccessAttendanceDto) {
    if (dto.date > getBangkokDateString()) {
      throw new BadRequestException('ไม่สามารถเช็คชื่อล่วงหน้าได้');
    }
    let affectedStudentIds: string[] = [];
    let calendarConfigured = false;
    const data = await this.withActiveGrantContext(
      rawToken,
      {
        capability: 'HOMEROOM_ATTENDANCE',
        assignmentId: dto.assignmentId,
        operation: 'SUBMIT_ATTENDANCE',
      },
      async (context, queryRunner) => {
        if (!context.classroomId) throw new ForbiddenException('ไม่พบห้องเรียนใน assignment');
        const allowedStudentIds = await this.repository.listRosterIds(
          Number(context.classroomId),
          queryRunner,
        );
        const result = await this.attendanceWriteService.saveAttendanceWithinTransaction(
          dto.records.map((record) => ({ student_id: record.studentId, status: record.status })),
          {
            actorUserId: context.teacherUserId,
            actorLabel: context.teacherUsername,
            recorder: context.teacherUsername,
            allowedStudentIds,
          },
          createSqlQueryExecutor(queryRunner),
          undefined,
          undefined,
          dto.date,
        );
        affectedStudentIds = result.affectedStudentIds;
        calendarConfigured = result.calendarConfigured;
        return { session: result.session, calendarConfigured: result.calendarConfigured };
      },
    );

    await this.riskProfileService
      .enqueueStudents(affectedStudentIds, 'teacher-access-attendance-save')
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
