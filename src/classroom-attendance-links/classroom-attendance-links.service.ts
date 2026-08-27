import { randomUUID, timingSafeEqual } from 'node:crypto';
import * as QRCode from 'qrcode';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { QueryRunner } from 'typeorm';
import {
  isUnconfiguredDataScope,
  normalizeDataScope,
  type AuthenticatedRequestUser,
  type DataScope,
} from '../auth';
import { AraIdChallengeStore } from '../araid/araid-challenge.store';
import { AraIdService } from '../araid/araid.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import type { AuditAction } from '../audit-log/dto/audit-log.dto';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import { MESSAGING_PROVIDER, type MessagingProvider } from '../common/messaging/messaging.types';
import { generateToken, hashToken } from '../common/utils/helpers';
import { googleLoginConfig } from '../config/google-login.config';
import { TeacherLineService } from '../teacher-line/teacher-line.service';
import type {
  BulkCreateClassroomAttendanceLinksDto,
  ClassroomLineGroupInvitationDto,
  ListClassroomAttendanceLinksDto,
  ResendClassroomAttendanceLinkLineDto,
} from './dto/classroom-attendance-links.dto';
import {
  CLASSROOM_LINK_ARAID_SCOPE,
  CLASSROOM_LINK_PATH,
} from './classroom-attendance-links.constants';
import { ClassroomAttendanceLinksRepository } from './classroom-attendance-links.repository';
import type {
  ClassroomLinkLineDeliveryFailureCode,
  ClassroomLinkListRow,
  ClassroomLinkRow,
  AuthorizedClassroomCheckIn,
  ExternalTeacherRow,
} from './classroom-attendance-links.types';
import { ClassroomLinkSessionStore } from './classroom-link-session.store';
import { ScopedGoogleLoginStateStore } from '../google-login/scoped-google-login-state.store';
import { GoogleOidcProvider } from './google-oidc.provider';

@Injectable()
export class ClassroomAttendanceLinksService {
  private readonly logger = new Logger(ClassroomAttendanceLinksService.name);

  constructor(
    private readonly repository: ClassroomAttendanceLinksRepository,
    private readonly encryption: TokenEncryptionService,
    private readonly sessions: ClassroomLinkSessionStore,
    private readonly googleStates: ScopedGoogleLoginStateStore,
    private readonly google: GoogleOidcProvider,
    private readonly araId: AraIdService,
    private readonly araIdChallenges: AraIdChallengeStore,
    private readonly audit: AuditLogService,
    @Inject(MESSAGING_PROVIDER) private readonly messaging: MessagingProvider,
    private readonly teacherLine: TeacherLineService,
    @Inject(googleLoginConfig.KEY)
    private readonly googleConfig: ConfigType<typeof googleLoginConfig>,
  ) {}

  private actorScope(actor: AuthenticatedRequestUser): DataScope {
    const scope = normalizeDataScope(actor.data_scope) ?? {};
    if (scope.own_only === true || isUnconfiguredDataScope(scope)) {
      throw new ForbiddenException('ขอบเขตบัญชีไม่อนุญาตให้จัดการลิงก์ห้องเรียน');
    }
    return scope;
  }

  private actorId(actor: AuthenticatedRequestUser): number {
    const id = resolveAuditActorId(actor);
    if (id === null) throw new ForbiddenException('ไม่พบผู้ใช้ที่จัดการลิงก์');
    return id;
  }

  private groupInvitationScope(actor: AuthenticatedRequestUser): DataScope {
    const scope = this.actorScope(actor);
    if ((scope.grade_levels?.length ?? 0) > 0 || (scope.room_ids?.length ?? 0) > 0) {
      throw new ForbiddenException('ขอบเขตบัญชีไม่อนุญาตให้จัดการลิงก์ระดับโรงเรียน');
    }
    return scope;
  }

  private async requireGroupInvitationSchool(
    schoolId: number,
    actor: AuthenticatedRequestUser,
  ): Promise<{ id: number; name: string }> {
    const school = await this.repository.findActiveSchoolInScope(
      schoolId,
      this.groupInvitationScope(actor),
    );
    if (!school) throw new NotFoundException('ไม่พบโรงเรียนในขอบเขตของคุณ');
    return school;
  }

  private status(row: ClassroomLinkListRow): 'ACTIVE' | 'INACTIVE' | 'NOT_CREATED' {
    if (!row.id) return 'NOT_CREATED';
    if (row.link_status === 'INACTIVE') return 'INACTIVE';
    if (
      row.school_status !== 'ACTIVE' ||
      row.term_status !== 'ACTIVE' ||
      row.classroom_status !== 'ACTIVE'
    ) {
      return 'INACTIVE';
    }
    return 'ACTIVE';
  }

  private presentation(row: ClassroomLinkListRow) {
    const homeroomTeachers =
      row.homeroom_teachers ??
      (row.homeroom_teacher_id && row.homeroom_teacher_name
        ? [
            {
              teacherId: row.homeroom_teacher_id,
              teacherName: row.homeroom_teacher_name,
              hasPhoto: row.homeroom_teacher_has_photo,
              isPrimary: true,
            },
          ]
        : []);
    return {
      id: row.id,
      schoolId: row.school_id,
      schoolName: row.school_name,
      schoolTermId: Number(row.school_term_id),
      academicYear: row.academic_year,
      semester: row.semester,
      classroomId: Number(row.classroom_id),
      gradeLevelId: row.grade_level_id,
      gradeLabel: row.grade_label,
      roomNumber: row.legacy_room_number,
      roomName: row.room_name,
      homeroomTeacherId: row.homeroom_teacher_id,
      homeroomTeacherName: row.homeroom_teacher_name,
      homeroomTeacherPhotoUrl: row.homeroom_teacher_has_photo
        ? `/api/teacher-profiles/${row.homeroom_teacher_id}/photo`
        : null,
      homeroomTeachers: homeroomTeachers.map((teacher) => ({
        teacherId: teacher.teacherId,
        teacherName: teacher.teacherName,
        photoUrl: teacher.hasPhoto ? `/api/teacher-profiles/${teacher.teacherId}/photo` : null,
        isPrimary: teacher.isPrimary,
      })),
      lineDelivery: row.id ? this.lineDeliveryPresentation(row as ClassroomLinkRow) : null,
      status: this.status(row),
      issuedAt: row.issued_at ? new Date(row.issued_at).toISOString() : null,
      rotatedAt: row.rotated_at ? new Date(row.rotated_at).toISOString() : null,
      lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : null,
      latestSession: row.latest_session_id
        ? {
            id: row.latest_session_id,
            attendanceDate: row.latest_session_date,
            status: row.latest_session_status,
            submittedAt: row.latest_session_submitted_at
              ? new Date(row.latest_session_submitted_at).toISOString()
              : null,
          }
        : null,
    };
  }

  private lineDeliveryPresentation(row: ClassroomLinkRow) {
    const currentMembershipId = row.homeroom_teacher_membership_id;
    const recipientChanged =
      row.line_delivery_teacher_membership_id !== null &&
      row.line_delivery_teacher_membership_id !== currentMembershipId;
    const status = recipientChanged ? ('NEEDS_RESEND' as const) : row.line_delivery_status;
    return {
      status,
      failureCode: recipientChanged ? null : row.line_delivery_failure_code,
      recipientTeacherMembershipId: currentMembershipId,
      recipientTeacherName: row.homeroom_teacher_name,
      accountState: row.line_provider_user_id
        ? (row.line_friend_state ?? 'UNKNOWN')
        : ('NOT_VERIFIED' as const),
      attemptCount: Number(row.line_delivery_attempt_count),
      lastAttemptedAt: row.line_delivery_last_attempted_at
        ? new Date(row.line_delivery_last_attempted_at).toISOString()
        : null,
      deliveredAt: row.line_delivered_at ? new Date(row.line_delivered_at).toISOString() : null,
      canRetry:
        row.link_status === 'ACTIVE' &&
        currentMembershipId !== null &&
        row.line_provider_user_id !== null &&
        row.line_friend_state === 'FRIEND' &&
        this.messaging.isEnabled() &&
        status !== 'SENDING',
    };
  }

  private accessUrl(baseUrl: string, token: string): string {
    return `${baseUrl.replace(/\/$/, '')}${CLASSROOM_LINK_PATH}#token=${encodeURIComponent(token)}`;
  }

  async list(query: ListClassroomAttendanceLinksDto, actor: AuthenticatedRequestUser) {
    const result = await this.repository.list({
      schoolId: query.schoolId,
      schoolTermId: query.schoolTermId,
      search: query.search,
      gradeLevelId: query.gradeLevelId,
      linkStatus: query.linkStatus,
      homeroomStatus: query.homeroomStatus,
      page: query.page,
      limit: query.limit,
      scope: this.actorScope(actor),
    });
    return {
      success: true,
      data: result.rows.map((row) => this.presentation(row)),
      meta: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }

  async issueLineGroupInvitation(
    input: ClassroomLineGroupInvitationDto,
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    const actorId = this.actorId(actor);
    const school = await this.requireGroupInvitationSchool(input.schoolId, actor);
    const result = await this.teacherLine.issueGroupInvitation({
      schoolId: school.id,
      schoolName: school.name,
      issuedBy: actorId,
      startsAt: new Date(input.startsAt),
      expiresAt: new Date(input.expiresAt),
      baseUrl,
    });
    await this.audit.record({
      actorUserId: actorId,
      actorLabel: actor.username,
      action: 'TEACHER_LINE_INVITATION_ISSUE',
      targetType: 'teacher_line_group_invitation',
      targetId: result.id,
      metadata: {
        invitationMode: 'GROUP',
        schoolId: school.id,
        startsAt: result.startsAt,
        expiresAt: result.expiresAt,
      },
      ip: null,
    });
    return { success: true, data: result };
  }

  async getLineGroupInvitation(schoolId: number, actor: AuthenticatedRequestUser, baseUrl: string) {
    await this.requireGroupInvitationSchool(schoolId, actor);
    return {
      success: true,
      data: await this.teacherLine.getActiveGroupInvitation(schoolId, baseUrl),
    };
  }

  async updateLineGroupInvitation(
    invitationId: string,
    input: ClassroomLineGroupInvitationDto,
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    const actorId = this.actorId(actor);
    await this.requireGroupInvitationSchool(input.schoolId, actor);
    const result = await this.teacherLine.updateGroupInvitation({
      id: invitationId,
      schoolId: input.schoolId,
      startsAt: new Date(input.startsAt),
      expiresAt: new Date(input.expiresAt),
      baseUrl,
    });
    await this.audit.record({
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

  async revokeLineGroupInvitation(
    invitationId: string,
    schoolId: number,
    actor: AuthenticatedRequestUser,
  ) {
    const actorId = this.actorId(actor);
    await this.requireGroupInvitationSchool(schoolId, actor);
    const revoked = await this.teacherLine.revokeGroupInvitation(invitationId, schoolId, actorId);
    if (!revoked) throw new GoneException('ลิงก์ยืนยัน LINE ถูกปิดหรือหมดอายุแล้ว');
    await this.audit.record({
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

  async bulkCreate(
    dto: BulkCreateClassroomAttendanceLinksDto,
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    const classroomIds = dto.allClassrooms === true ? undefined : dto.classroomIds;
    if (dto.allClassrooms === true && dto.classroomIds?.length) {
      throw new BadRequestException('ห้ามส่งรายการห้องพร้อมกับการเลือกทุกห้อง');
    }
    if (!dto.allClassrooms && (!classroomIds || classroomIds.length === 0)) {
      throw new BadRequestException('กรุณาเลือกห้องเรียนหรือเลือกสร้างทุกห้อง');
    }
    const actorId = this.actorId(actor);
    const created = await this.repository.withTransaction(async (runner) => {
      const classrooms = await this.repository.lockEligibleClassrooms(
        {
          schoolId: dto.schoolId,
          schoolTermId: dto.schoolTermId,
          classroomIds,
          scope: this.actorScope(actor),
        },
        runner,
      );
      if (classroomIds && classrooms.length !== classroomIds.length) {
        throw new NotFoundException('มีห้องเรียนที่ไม่พบ ไม่เปิดใช้งาน หรืออยู่นอกขอบเขต');
      }
      if (classrooms.length > 500) {
        throw new BadRequestException('สร้างลิงก์ได้ครั้งละไม่เกิน 500 ห้อง กรุณาเลือกห้องเป็นชุด');
      }
      if (classrooms.length === 0) throw new NotFoundException('ไม่พบห้องเรียนที่สร้างลิงก์ได้');
      const candidates = classrooms.map((classroom) => {
        const rawToken = generateToken();
        return {
          schoolId: dto.schoolId,
          schoolTermId: dto.schoolTermId,
          classroomId: Number(classroom.classroom_id),
          rawToken,
          tokenHash: hashToken(rawToken),
          tokenEncrypted: this.encryption.encrypt(rawToken),
          actorId,
        };
      });
      const storedRows = await this.repository.upsertLinks(candidates, runner);
      if (storedRows.length !== classrooms.length) {
        throw new ConflictException('สร้างลิงก์ห้องเรียนไม่สำเร็จ');
      }
      const candidateByClassroom = new Map(
        candidates.map((candidate) => [candidate.classroomId, candidate]),
      );
      const rows: Array<{
        id: string;
        accessUrl: string;
        created: boolean;
        row: ClassroomLinkRow;
      }> = storedRows.map((stored) => {
        const candidate = candidateByClassroom.get(Number(stored.classroom_id));
        if (!candidate) throw new ConflictException('สร้างลิงก์ห้องเรียนไม่สำเร็จ');
        const storedToken = this.decryptToken(stored.token_encrypted);
        return {
          id: stored.id,
          accessUrl: this.accessUrl(baseUrl, storedToken),
          created: stored.token_hash === candidate.tokenHash,
          row: stored,
        };
      });
      await this.audit.recordAtomic(
        {
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'CLASSROOM_ATTENDANCE_LINK_BULK_CREATE',
          targetType: 'classroom_attendance_links',
          targetId: `${dto.schoolTermId}`,
          metadata: {
            schoolId: dto.schoolId,
            count: rows.length,
            allClassrooms: dto.allClassrooms === true,
          },
          ip: null,
        },
        runner,
      );
      return rows;
    });
    const deliveryByLink = await this.deliverLinks(
      created
        .filter((item) => item.created)
        .map((item) => ({ row: item.row, accessUrl: item.accessUrl })),
      actor,
      randomUUID(),
    );
    return {
      success: true,
      data: created.map(({ row, accessUrl, ...item }) => ({
        ...item,
        ...(created.length === 1 ? { accessUrl } : {}),
        lineDelivery: deliveryByLink.get(item.id) ?? this.lineDeliveryPresentation(row),
      })),
    };
  }

  async redisplay(id: string, actor: AuthenticatedRequestUser, baseUrl: string) {
    const row = await this.scopedLink(id, actor);
    return {
      success: true,
      data: {
        id: row.id,
        accessUrl: this.accessUrl(baseUrl, this.decryptToken(row.token_encrypted)),
      },
    };
  }

  async rotate(id: string, actor: AuthenticatedRequestUser, baseUrl: string) {
    const actorId = this.actorId(actor);
    const result = await this.repository.withTransaction(async (runner) => {
      const row = await this.repository.findById(id, runner, true);
      if (!row || !(await this.repository.isLinkInScope(id, this.actorScope(actor)))) {
        throw new NotFoundException('ไม่พบลิงก์ห้องเรียนในขอบเขตของคุณ');
      }
      const rawToken = generateToken();
      await this.repository.updateToken(
        id,
        hashToken(rawToken),
        this.encryption.encrypt(rawToken),
        actorId,
        runner,
      );
      await this.auditLinkAction('CLASSROOM_ATTENDANCE_LINK_ROTATE', row, actor, runner);
      return rawToken;
    });
    const row = await this.repository.findById(id);
    return {
      success: true,
      data: {
        id,
        accessUrl: this.accessUrl(baseUrl, result),
        lineDelivery: row ? this.lineDeliveryPresentation(row) : null,
      },
    };
  }

  async resendLine(
    id: string,
    dto: ResendClassroomAttendanceLinkLineDto,
    actor: AuthenticatedRequestUser,
    baseUrl: string,
  ) {
    const row = await this.scopedLink(id, actor);
    if (row.link_status !== 'ACTIVE') {
      throw new GoneException('ลิงก์ห้องเรียนถูกปิดแล้ว');
    }
    const result = await this.deliverLinks(
      [
        {
          row,
          accessUrl: this.accessUrl(baseUrl, this.decryptToken(row.token_encrypted)),
        },
      ],
      actor,
      dto.deliveryRequestId,
    );
    return {
      success: true,
      data: { id, lineDelivery: result.get(id) ?? this.lineDeliveryPresentation(row) },
    };
  }

  async deactivate(id: string, actor: AuthenticatedRequestUser) {
    await this.repository.withTransaction(async (runner) => {
      const row = await this.repository.findById(id, runner, true);
      if (!row || !(await this.repository.isLinkInScope(id, this.actorScope(actor)))) {
        throw new NotFoundException('ไม่พบลิงก์ห้องเรียนในขอบเขตของคุณ');
      }
      await this.repository.deactivate(id, this.actorId(actor), runner);
      await this.auditLinkAction('CLASSROOM_ATTENDANCE_LINK_DEACTIVATE', row, actor, runner);
    });
    return { success: true, data: { id, status: 'INACTIVE' as const } };
  }

  async context(rawToken: string | undefined, sessionToken?: string) {
    const session = await this.sessions.read(sessionToken);
    const link = rawToken
      ? await this.usableLink(rawToken)
      : session
        ? await this.repository.findUsableById(session.linkId)
        : null;
    if (!link) throw new UnauthorizedException('กรุณาเปิดจากลิงก์ห้องเรียน');
    const sessionMatchesLink =
      session?.linkId === link.id &&
      session.tokenHash === link.token_hash &&
      session.schoolId === link.school_id;
    if (session && !sessionMatchesLink && !rawToken) {
      throw new UnauthorizedException('เซสชันไม่ตรงกับลิงก์ห้องเรียน');
    }
    const teacher = sessionMatchesLink ? await this.validateSession(session, link) : null;
    return {
      success: true,
      data: {
        school: { id: link.school_id, name: link.school_name },
        term: {
          id: Number(link.school_term_id),
          academicYear: link.academic_year,
          semester: link.semester,
        },
        classroom: {
          id: Number(link.classroom_id),
          gradeLabel: link.grade_label,
          roomNumber: link.legacy_room_number,
          roomName: link.room_name,
        },
        authentication: teacher
          ? {
              status: 'AUTHENTICATED' as const,
              provider: session!.provider,
              displayName: teacher.teacher_display_name,
            }
          : { status: 'REQUIRED' as const, providers: ['GOOGLE', 'ARAID'] as const },
      },
    };
  }

  async authorizeCheckInSession(sessionToken?: string): Promise<AuthorizedClassroomCheckIn> {
    const session = await this.sessions.read(sessionToken);
    if (!session) throw new UnauthorizedException('กรุณายืนยันตัวตนครูก่อนเช็กชื่อ');
    const link = await this.repository.findUsableById(session.linkId);
    if (!link) throw new UnauthorizedException('ลิงก์ห้องเรียนหมดอายุหรือถูกปิดใช้งาน');
    const teacher = await this.validateSession(session, link);
    return {
      linkId: link.id,
      schoolId: link.school_id,
      schoolTermId: Number(link.school_term_id),
      classroomId: Number(link.classroom_id),
      gradeLevelId: link.grade_level_id,
      roomNumber: Number(link.legacy_room_number),
      teacherId: teacher.teacher_id,
      teacherMembershipId: teacher.teacher_membership_id,
      teacherDisplayName: teacher.teacher_display_name,
      provider: session.provider,
    };
  }

  async googleStart(rawToken: string) {
    const link = await this.usableLink(rawToken);
    const login = await this.googleStates.create('classroom-link', {
      subjectId: link.id,
      tokenHash: link.token_hash,
      schoolId: link.school_id,
    });
    return {
      success: true,
      data: {
        authorizationUrl: this.google.authorizationUrl(
          login.state,
          login.nonce,
          this.googleConfig.classroomCallbackUrl,
        ),
      },
    };
  }

  async googleCallback(code: string, state: string): Promise<string> {
    const login = await this.googleStates.consume('classroom-link', state);
    if (!login) throw new GoneException('คำขอ Google Login หมดอายุหรือถูกใช้แล้ว');
    const link = await this.repository.findUsableByTokenHash(login.tokenHash);
    if (!link || link.id !== login.subjectId || link.school_id !== login.schoolId)
      throw new GoneException('ลิงก์ห้องเรียนถูกเปลี่ยนหรือปิดแล้ว');
    const identity = await this.google.exchange(
      code,
      login.nonce,
      this.googleConfig.classroomCallbackUrl,
    );
    const teacher = await this.repository.findTeacherByEmail(identity.email, link.school_id);
    this.assertActiveTeacher(teacher);
    if (identity.persistIdentity !== false) {
      await this.bindIdentity(teacher!, 'GOOGLE', identity.subject, identity.email);
    }
    return await this.issueSession(link, teacher!, 'GOOGLE');
  }

  async googleDevelopment(rawToken: string, email: string): Promise<string> {
    const identity = this.google.developmentIdentity(email);
    const link = await this.usableLink(rawToken);
    const teacher = await this.repository.findTeacherByEmail(identity.email, link.school_id);
    this.assertActiveTeacher(teacher);
    return await this.issueSession(link, teacher!, 'GOOGLE');
  }

  async createAraIdChallenge(rawToken: string, baseUrl: string) {
    const link = await this.usableLink(rawToken);
    const challenge = await this.araIdChallenges.create(CLASSROOM_LINK_ARAID_SCOPE, link.id, {
      tokenHash: link.token_hash,
    });
    const verificationUrl = new URL('/araid/authorize', baseUrl);
    // The phone-side page reads `scope`, the same key the task-link and
    // admin-login challenges use. A different key left it with no scope at all,
    // so every scanned QR landed on "ลิงก์ยืนยันไม่ครบถ้วน".
    verificationUrl.hash = `challenge=${encodeURIComponent(challenge.token)}&scope=${CLASSROOM_LINK_ARAID_SCOPE}`;
    return {
      success: true,
      data: {
        challengeToken: challenge.token,
        verificationUrl: verificationUrl.toString(),
        qrDataUrl: await QRCode.toDataURL(verificationUrl.toString(), {
          width: 320,
          margin: 2,
          errorCorrectionLevel: 'M',
        }),
        referenceCode: challenge.referenceCode,
        expiresAt: new Date(challenge.entryExpiresAt).toISOString(),
      },
    };
  }

  async beginAraIdChallenge(challengeToken: string, existingAuthorization?: string) {
    if (existingAuthorization) {
      const resumed = await this.araIdChallenges.resume(
        CLASSROOM_LINK_ARAID_SCOPE,
        challengeToken,
        existingAuthorization,
      );
      if (resumed) return resumed;
    }
    const authorization = await this.araIdChallenges.claimOrRenew(
      CLASSROOM_LINK_ARAID_SCOPE,
      challengeToken,
    );
    if (!authorization) throw new GoneException('คำขอยืนยัน AraID หมดอายุแล้ว');
    return authorization;
  }

  async approveAraIdChallenge(
    authorizationToken: string,
    profileId: string,
    authenticatedAt: number,
  ) {
    const authorization = await this.araIdChallenges.readAuthorization(
      CLASSROOM_LINK_ARAID_SCOPE,
      authorizationToken,
    );
    if (!authorization) throw new GoneException('การยืนยัน AraID หมดอายุแล้ว');
    if (authenticatedAt < authorization.minimumAuthenticatedAt) {
      throw new UnauthorizedException('กรุณากรอก PIN AraID ใหม่เพื่อยืนยันลิงก์ห้องเรียน');
    }
    const tokenHash = this.scalarString(authorization.challenge.context.tokenHash);
    const link = await this.repository.findUsableByTokenHash(tokenHash);
    if (!link || link.id !== authorization.challenge.subjectId) {
      throw new GoneException('ลิงก์ห้องเรียนถูกเปลี่ยนหรือปิดแล้ว');
    }
    const identity = await this.araId.getVerifiedIdentityClaim(profileId);
    const citizenId = identity.identityNumber;
    const teacher = await this.repository.findTeacherByCitizenId(citizenId, link.school_id);
    this.assertActiveTeacher(teacher);
    if (!this.secureEqual(teacher!.citizen_id ?? '', citizenId)) {
      throw new ForbiddenException('ข้อมูล AraID ไม่ตรงกับครูในโรงเรียนนี้');
    }
    await this.bindIdentity(teacher!, 'THAID', identity.providerSubject, null);
    const approved = await this.araIdChallenges.approveAuthorization(
      CLASSROOM_LINK_ARAID_SCOPE,
      authorizationToken,
      {
        teacherId: teacher!.teacher_id,
        teacherMembershipId: teacher!.teacher_membership_id,
        schoolId: teacher!.school_id,
      },
    );
    if (!approved) throw new GoneException('คำขอยืนยัน AraID ถูกใช้หรือหมดอายุแล้ว');
    return { success: true, data: { approved: true } };
  }

  async pollAraIdChallenge(
    challengeToken: string,
  ): Promise<{ response: object; sessionToken?: string }> {
    const challenge = await this.araIdChallenges.read(CLASSROOM_LINK_ARAID_SCOPE, challengeToken);
    if (!challenge) throw new GoneException('คำขอยืนยัน AraID หมดอายุแล้ว');
    if (challenge.status === 'PENDING')
      return { response: { success: true, data: { status: 'PENDING' } } };
    if (challenge.status === 'CLAIMED') {
      return {
        response: {
          success: true,
          data: { status: 'IN_PROGRESS', expiresAt: new Date(challenge.expiresAt).toISOString() },
        },
      };
    }
    const consumed = await this.araIdChallenges.consumeApproved(
      CLASSROOM_LINK_ARAID_SCOPE,
      challengeToken,
    );
    if (!consumed) throw new GoneException('คำขอยืนยัน AraID ถูกใช้แล้ว');
    const link = await this.repository.findUsableByTokenHash(
      this.scalarString(consumed.context.tokenHash),
    );
    if (!link || link.id !== consumed.subjectId)
      throw new GoneException('ลิงก์ห้องเรียนถูกเปลี่ยนหรือปิดแล้ว');
    const teacher = await this.repository.findActiveMembership(
      this.scalarString(consumed.context.teacherMembershipId),
      link.school_id,
    );
    this.assertActiveTeacher(teacher);
    const sessionToken = await this.issueSession(link, teacher!, 'THAID');
    return { response: { success: true, data: { status: 'APPROVED' } }, sessionToken };
  }

  private async deliverLinks(
    links: Array<{ row: ClassroomLinkRow; accessUrl: string }>,
    actor: AuthenticatedRequestUser,
    deliveryRequestId: string,
  ): Promise<Map<string, ReturnType<ClassroomAttendanceLinksService['lineDeliveryPresentation']>>> {
    const presentations = new Map<
      string,
      ReturnType<ClassroomAttendanceLinksService['lineDeliveryPresentation']>
    >();
    if (links.length === 0) return presentations;

    const actorId = this.actorId(actor);
    const ready: Array<{ row: ClassroomLinkRow; accessUrl: string }> = [];

    for (const item of links) {
      let failureCode: Extract<
        ClassroomLinkLineDeliveryFailureCode,
        | 'HOMEROOM_UNAVAILABLE'
        | 'MESSAGING_DISABLED'
        | 'ACCOUNT_NOT_VERIFIED'
        | 'ACCOUNT_NOT_REACHABLE'
      > | null = null;
      if (!item.row.homeroom_teacher_membership_id) {
        failureCode = 'HOMEROOM_UNAVAILABLE';
      } else if (!this.messaging.isEnabled()) {
        failureCode = 'MESSAGING_DISABLED';
      } else if (!item.row.line_provider_user_id) {
        failureCode = 'ACCOUNT_NOT_VERIFIED';
      } else if (item.row.line_friend_state !== 'FRIEND') {
        failureCode = 'ACCOUNT_NOT_REACHABLE';
      }

      if (failureCode) {
        const updated = await this.repository.recordLineDeliveryNotReady(
          item.row.id,
          item.row.homeroom_teacher_membership_id,
          failureCode,
          actorId,
        );
        presentations.set(item.row.id, this.lineDeliveryPresentation(updated ?? item.row));
      } else {
        ready.push(item);
      }
    }

    const claimed = (
      await Promise.all(
        ready.map(async (item) => ({
          input: item,
          row: await this.repository.claimLineDelivery(
            item.row.id,
            item.row.homeroom_teacher_membership_id!,
            deliveryRequestId,
            actorId,
          ),
        })),
      )
    ).filter(
      (
        item,
      ): item is { input: { row: ClassroomLinkRow; accessUrl: string }; row: ClassroomLinkRow } => {
        if (item.row) return true;
        return false;
      },
    );

    for (const item of ready) {
      if (claimed.some((entry) => entry.input.row.id === item.row.id)) continue;
      const current = await this.repository.findById(item.row.id);
      presentations.set(item.row.id, this.lineDeliveryPresentation(current ?? item.row));
    }

    if (claimed.length === 0) return presentations;

    const byRecipient = new Map<string, Array<{ row: ClassroomLinkRow; accessUrl: string }>>();
    for (const item of claimed) {
      const providerUserId = item.row.line_provider_user_id;
      if (!providerUserId) continue;
      const group = byRecipient.get(providerUserId) ?? [];
      group.push({ row: item.row, accessUrl: item.input.accessUrl });
      byRecipient.set(providerUserId, group);
    }

    const messages = [...byRecipient.entries()].map(([providerUserId, items]) => ({
      providerUserId,
      text: [
        'ลิงก์เช็กชื่อห้องเรียน',
        ...items.map(
          (item) => `• ${item.row.grade_label}/${item.row.legacy_room_number}: ${item.accessUrl}`,
        ),
        'ครูที่เปิดใช้งานในโรงเรียนสามารถยืนยันตัวตนและใช้ลิงก์นี้ได้',
      ].join('\n'),
    }));

    let deliveryResults: Awaited<ReturnType<MessagingProvider['sendMessages']>>;
    try {
      deliveryResults = await this.messaging.sendMessages(
        messages,
        `classroom-links-${deliveryRequestId}`,
      );
    } catch {
      this.logger.warn(`LINE delivery failed for ${messages.length} classroom-link recipient(s)`);
      deliveryResults = messages.map((message) => ({
        providerUserId: message.providerUserId,
        delivered: false,
      }));
    }
    const resultByRecipient = new Map(
      deliveryResults.map((result) => [result.providerUserId, result.delivered]),
    );

    const completed = await Promise.all(
      claimed.map(async (item) => {
        const delivered = resultByRecipient.get(item.row.line_provider_user_id!) === true;
        const updated = await this.repository.finishLineDelivery(
          item.row.id,
          deliveryRequestId,
          delivered,
          delivered ? null : 'PROVIDER_UNAVAILABLE',
          actorId,
        );
        return { row: updated ?? item.row, delivered };
      }),
    );

    for (const item of completed) {
      presentations.set(item.row.id, this.lineDeliveryPresentation(item.row));
      try {
        await this.audit.record({
          actorUserId: actorId,
          actorLabel: actor.username,
          action: 'CLASSROOM_ATTENDANCE_LINK_LINE_SEND',
          targetType: 'classroom_attendance_links',
          targetId: item.row.id,
          metadata: {
            schoolId: item.row.school_id,
            classroomId: Number(item.row.classroom_id),
            teacherMembershipId: item.row.line_delivery_teacher_membership_id,
            delivered: item.delivered,
            deliveryRequestId,
          },
          ip: null,
        });
      } catch {
        this.logger.error(`Could not audit classroom-link LINE delivery for link ${item.row.id}`);
      }
    }

    return presentations;
  }

  private async scopedLink(id: string, actor: AuthenticatedRequestUser): Promise<ClassroomLinkRow> {
    if (!(await this.repository.isLinkInScope(id, this.actorScope(actor)))) {
      throw new NotFoundException('ไม่พบลิงก์ห้องเรียนในขอบเขตของคุณ');
    }
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundException('ไม่พบลิงก์ห้องเรียน');
    return row;
  }

  private async usableLink(rawToken: string): Promise<ClassroomLinkRow> {
    if (!/^[0-9a-f]{64}$/i.test(rawToken))
      throw new UnauthorizedException('ลิงก์ห้องเรียนไม่ถูกต้อง');
    const row = await this.repository.findUsableByTokenHash(hashToken(rawToken));
    if (!row) throw new GoneException('ลิงก์ห้องเรียนถูกปิด เปลี่ยน หรือไม่พร้อมใช้งาน');
    return row;
  }

  private decryptToken(encrypted: string): string {
    try {
      return this.encryption.decrypt(encrypted);
    } catch {
      throw new ConflictException('ลิงก์นี้ไม่สามารถแสดงซ้ำได้ กรุณาหมุนลิงก์ใหม่');
    }
  }

  private assertActiveTeacher(teacher: ExternalTeacherRow | null): void {
    if (
      !teacher ||
      teacher.teacher_status !== 'ACTIVE' ||
      teacher.membership_status !== 'ACTIVE' ||
      teacher.teacher_deleted_at ||
      teacher.membership_deleted_at
    ) {
      throw new ForbiddenException('ไม่พบครูที่เปิดใช้งานในโรงเรียนเจ้าของลิงก์');
    }
  }

  private async bindIdentity(
    teacher: ExternalTeacherRow,
    provider: 'GOOGLE' | 'THAID',
    subject: string,
    email: string | null,
  ): Promise<void> {
    try {
      await this.repository.withTransaction(async (runner) => {
        await this.repository.bindExternalIdentity(
          {
            teacherId: teacher.teacher_id,
            provider,
            providerSubject: subject,
            normalizedEmail: email,
          },
          runner,
        );
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('EXTERNAL_IDENTITY_CONFLICT') || message.includes('unique')) {
        throw new ConflictException('บัญชีผู้ให้บริการนี้ผูกกับครูอื่นหรือข้อมูลเดิมไม่ตรงกัน');
      }
      throw error;
    }
  }

  private async issueSession(
    link: ClassroomLinkRow,
    teacher: ExternalTeacherRow,
    provider: 'GOOGLE' | 'THAID',
  ): Promise<string> {
    const token = await this.sessions.issue({
      linkId: link.id,
      tokenHash: link.token_hash,
      teacherId: teacher.teacher_id,
      teacherMembershipId: teacher.teacher_membership_id,
      schoolId: link.school_id,
      provider,
    });
    await this.repository.touchLinkUsed(link.id);
    return token;
  }

  private async validateSession(
    session: NonNullable<Awaited<ReturnType<ClassroomLinkSessionStore['read']>>>,
    link: ClassroomLinkRow,
  ): Promise<ExternalTeacherRow> {
    if (
      session.linkId !== link.id ||
      session.tokenHash !== link.token_hash ||
      session.schoolId !== link.school_id
    ) {
      throw new UnauthorizedException('เซสชันไม่ตรงกับลิงก์ห้องเรียน');
    }
    const teacher = await this.repository.findActiveMembership(
      session.teacherMembershipId,
      link.school_id,
    );
    this.assertActiveTeacher(teacher);
    if (teacher!.teacher_id !== session.teacherId)
      throw new UnauthorizedException('เซสชันครูไม่ถูกต้อง');
    return teacher!;
  }

  private async auditLinkAction(
    action: Extract<
      AuditAction,
      'CLASSROOM_ATTENDANCE_LINK_ROTATE' | 'CLASSROOM_ATTENDANCE_LINK_DEACTIVATE'
    >,
    row: ClassroomLinkRow,
    actor: AuthenticatedRequestUser,
    runner: QueryRunner,
  ): Promise<void> {
    await this.audit.recordAtomic(
      {
        actorUserId: this.actorId(actor),
        actorLabel: actor.username,
        action,
        targetType: 'classroom_attendance_links',
        targetId: row.id,
        metadata: { schoolId: row.school_id, classroomId: Number(row.classroom_id) },
        ip: null,
      },
      runner,
    );
  }

  private secureEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private scalarString(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  }
}
