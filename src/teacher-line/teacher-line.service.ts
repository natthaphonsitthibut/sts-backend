import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { QueryRunner } from 'typeorm';
import * as QRCode from 'qrcode';
import { AuditLogService } from '../audit-log/audit-log.service';
import { AraIdService } from '../araid/araid.service';
import { EmailService } from '../common/email/email.service';
import { MESSAGING_PROVIDER, type MessagingProvider } from '../common/messaging/messaging.types';
import { OtpStore } from '../common/otp/otp.store';
import { hashToken } from '../common/utils/helpers';
import { appConfig } from '../config/app.config';
import { authConfig } from '../config/auth.config';
import { lineConfig } from '../config/line.config';
import { TeacherLineRepository } from './teacher-line.repository';
import {
  type TeacherLineAraIdChallenge as StoredTeacherLineAraIdChallenge,
  TeacherLineAraIdChallengeStore,
} from './teacher-line-araid-challenge.store';
import { TeacherLineSessionStore } from './teacher-line-session.store';
import type { TeacherLineInvitationRow, TeacherLineLinkOutcome } from './teacher-line.types';

/**
 * Identical whether or not the address belongs to a teacher. Telling an
 * anonymous caller "no such teacher" would turn this public form into a way to
 * discover which staff emails exist.
 */
const GENERIC_OTP_REQUEST_MESSAGE =
  'ถ้าอีเมลนี้อยู่ในระบบ เราได้ส่งรหัสยืนยันไปให้แล้ว กรุณาตรวจสอบกล่องจดหมาย';
const GENERIC_OTP_VERIFY_MESSAGE = 'อีเมลหรือรหัสยืนยันไม่ถูกต้อง';

/** Namespaces this feature's codes in the shared OTP store. */
function otpKey(teacherId: string): string {
  return `line-link:${teacherId}`;
}

function invitationOtpKey(invitationId: string): string {
  return `line-link-invitation:${invitationId}`;
}

@Injectable()
export class TeacherLineService {
  private readonly logger = new Logger(TeacherLineService.name);

  constructor(
    private readonly repository: TeacherLineRepository,
    private readonly sessionStore: TeacherLineSessionStore,
    private readonly otpStore: OtpStore,
    private readonly emailService: EmailService,
    private readonly auditLog: AuditLogService,
    private readonly araIdService: AraIdService,
    private readonly araIdChallengeStore: TeacherLineAraIdChallengeStore,
    @Inject(MESSAGING_PROVIDER)
    private readonly messaging: MessagingProvider,
    @Inject(lineConfig.KEY)
    private readonly line: ConfigType<typeof lineConfig>,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
    @Inject(authConfig.KEY)
    private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  isEnabled(): boolean {
    return this.messaging.isEnabled();
  }

  private assertEnabled(): void {
    if (!this.messaging.isEnabled()) {
      throw new ServiceUnavailableException('ระบบเชื่อมบัญชี LINE ยังไม่เปิดใช้งาน');
    }
  }

  private frontendBaseUrl(): string {
    if (!this.app.frontendBaseUrl) {
      throw new ServiceUnavailableException('ระบบเชื่อมบัญชี LINE ยังตั้งค่าไม่ครบ');
    }
    return this.app.frontendBaseUrl;
  }

  private assertInvitationUsable(invitation: TeacherLineInvitationRow | null): asserts invitation {
    if (!invitation) throw new GoneException('ลิงก์ยืนยัน LINE ไม่ถูกต้องหรือหมดอายุแล้ว');
    if (
      invitation.consumed_at ||
      invitation.revoked_at ||
      new Date(invitation.expires_at).getTime() <= Date.now() ||
      invitation.teacher_status !== 'ACTIVE' ||
      invitation.membership_status !== 'ACTIVE' ||
      invitation.membership_deleted_at
    ) {
      throw new GoneException('ลิงก์ยืนยัน LINE ไม่ถูกต้องหรือหมดอายุแล้ว');
    }
  }

  async issueGroupInvitation(input: {
    schoolId: number;
    schoolName: string;
    startsAt: Date;
    expiresAt: Date;
    baseUrl: string;
  }): Promise<{
    id: string;
    schoolId: number;
    schoolName: string;
    url: string;
    startsAt: string;
    expiresAt: string;
  }> {
    this.assertEnabled();
    const { startsAt, expiresAt } = this.validateGroupInvitationTiming(
      input.startsAt,
      input.expiresAt,
    );
    const created = await this.sessionStore.createGroupInvitation({
      schoolId: input.schoolId,
      schoolName: input.schoolName,
      startsAt,
      expiresAt,
    });
    if (!created) {
      throw new ConflictException('โรงเรียนนี้มีลิงก์ยืนยัน LINE ที่ยังใช้งานอยู่แล้ว');
    }
    const { id, token } = created;
    const url = new URL('/line-link', input.baseUrl);
    url.hash = `token=${encodeURIComponent(token)}`;
    return {
      id,
      schoolId: input.schoolId,
      schoolName: input.schoolName,
      url: url.toString(),
      startsAt: new Date(startsAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async getActiveGroupInvitation(
    schoolId: number,
    baseUrl: string,
  ): Promise<{
    id: string;
    schoolId: number;
    schoolName: string;
    url: string;
    startsAt: string;
    expiresAt: string;
    status: 'PENDING' | 'ACTIVE';
  } | null> {
    const invitation = await this.sessionStore.readActiveGroupInvitation(schoolId);
    if (!invitation || !invitation.shareToken || invitation.expiresAt <= Date.now()) return null;
    const url = new URL('/line-link', baseUrl);
    url.hash = `token=${encodeURIComponent(invitation.shareToken)}`;
    return {
      id: invitation.id,
      schoolId: invitation.schoolId,
      schoolName: invitation.schoolName,
      url: url.toString(),
      startsAt: new Date(invitation.startsAt).toISOString(),
      expiresAt: new Date(invitation.expiresAt).toISOString(),
      status: invitation.startsAt > Date.now() ? 'PENDING' : 'ACTIVE',
    };
  }

  async revokeGroupInvitation(id: string, schoolId: number): Promise<boolean> {
    return await this.sessionStore.revokeGroupInvitation(id, schoolId);
  }

  async updateGroupInvitation(input: {
    id: string;
    schoolId: number;
    startsAt: Date;
    expiresAt: Date;
    baseUrl: string;
  }): Promise<{
    id: string;
    schoolId: number;
    schoolName: string;
    url: string;
    startsAt: string;
    expiresAt: string;
    status: 'PENDING' | 'ACTIVE';
  }> {
    this.assertEnabled();
    const { startsAt, expiresAt } = this.validateGroupInvitationTiming(
      input.startsAt,
      input.expiresAt,
    );
    const updated = await this.sessionStore.updateGroupInvitation(input.id, input.schoolId, {
      startsAt,
      expiresAt,
    });
    if (!updated) throw new GoneException('ลิงก์ยืนยัน LINE ถูกปิดหรือหมดอายุแล้ว');
    const invitation = await this.getActiveGroupInvitation(input.schoolId, input.baseUrl);
    if (!invitation) throw new GoneException('ลิงก์ยืนยัน LINE ถูกปิดหรือหมดอายุแล้ว');
    return invitation;
  }

  private validateGroupInvitationTiming(
    startsAtInput: Date,
    expiresAtInput: Date,
  ): { startsAt: number; expiresAt: number } {
    const now = Date.now();
    const startsAt = startsAtInput.getTime();
    const expiresAt = expiresAtInput.getTime();
    const maximumDurationMs = 366 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(startsAt) || !Number.isFinite(expiresAt)) {
      throw new BadRequestException('วันเวลาเริ่มหรือหมดอายุไม่ถูกต้อง');
    }
    if (expiresAt <= startsAt || expiresAt <= now) {
      throw new BadRequestException('วันหมดอายุต้องอยู่หลังวันเริ่มและยังไม่ผ่านไปแล้ว');
    }
    if (expiresAt - startsAt > maximumDurationMs || expiresAt - now > maximumDurationMs) {
      throw new BadRequestException('ลิงก์ยืนยัน LINE กำหนดอายุได้ไม่เกิน 1 ปี');
    }
    return { startsAt, expiresAt };
  }

  async resolveGroupInvitation(rawToken: string): Promise<{
    schoolId: number;
    schoolName: string;
    startsAt: string;
    expiresAt: string;
    status: 'PENDING' | 'ACTIVE';
  }> {
    this.assertEnabled();
    const invitation = await this.sessionStore.readGroupInvitation(rawToken.trim());
    if (!invitation || invitation.expiresAt <= Date.now()) {
      throw new GoneException('ลิงก์ยืนยัน LINE ไม่ถูกต้องหรือหมดอายุแล้ว');
    }
    return {
      schoolId: invitation.schoolId,
      schoolName: invitation.schoolName,
      startsAt: new Date(invitation.startsAt).toISOString(),
      expiresAt: new Date(invitation.expiresAt).toISOString(),
      status: invitation.startsAt > Date.now() ? 'PENDING' : 'ACTIVE',
    };
  }

  private async assertGroupInvitationActive(rawToken: string) {
    const invitation = await this.sessionStore.readGroupInvitation(rawToken.trim());
    if (!invitation || invitation.expiresAt <= Date.now()) {
      throw new GoneException('ลิงก์ยืนยัน LINE ไม่ถูกต้องหรือหมดอายุแล้ว');
    }
    if (invitation.startsAt > Date.now()) {
      throw new BadRequestException('ลิงก์ยืนยัน LINE ยังไม่ถึงเวลาเริ่มใช้งาน');
    }
    return invitation;
  }

  private maskEmail(email: string): string {
    const [localPart, domain] = email.split('@');
    if (!localPart || !domain) return '***';
    return `${localPart.slice(0, 1)}***@${domain}`;
  }

  async issueInvitation(
    input: {
      teacherMembershipId: number;
      teacherId: string;
      issuedBy: number;
      baseUrl: string;
    },
    queryRunner: QueryRunner,
  ): Promise<{ id: string; url: string; expiresAt: string }> {
    if (
      await this.repository.hasActiveAccountForTeacher(
        input.teacherId,
        this.line.messagingChannelId,
        queryRunner,
      )
    ) {
      throw new ConflictException('ครูคนนี้เชื่อมบัญชี LINE แล้ว กรุณาปลดการเชื่อมต่อก่อน');
    }
    const rawToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + this.line.invitationTtlHours * 60 * 60 * 1000);
    const invitation = await this.repository.createInvitation(
      {
        teacherMembershipId: input.teacherMembershipId,
        tokenHash: hashToken(rawToken),
        issuedBy: input.issuedBy,
        expiresAt,
      },
      queryRunner,
    );
    const invitationUrl = new URL('/line-link/invite', input.baseUrl);
    invitationUrl.hash = `token=${encodeURIComponent(rawToken)}`;
    return {
      id: invitation.id,
      url: invitationUrl.toString(),
      expiresAt: new Date(invitation.expires_at).toISOString(),
    };
  }

  async revokeInvitation(
    teacherMembershipId: number,
    revokedBy: number,
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    return await this.repository.revokeActiveInvitation(
      teacherMembershipId,
      revokedBy,
      'REVOKED_BY_SCHOOL_ADMIN',
      queryRunner,
    );
  }

  async resolveInvitation(rawToken: string): Promise<{
    teacherName: string;
    maskedEmail: string;
    expiresAt: string;
  }> {
    this.assertEnabled();
    const invitation = await this.repository.findInvitationByTokenHash(hashToken(rawToken.trim()));
    this.assertInvitationUsable(invitation);
    return {
      teacherName: `${invitation.first_name} ${invitation.last_name}`.trim(),
      maskedEmail: this.maskEmail(invitation.email),
      expiresAt: new Date(invitation.expires_at).toISOString(),
    };
  }

  async requestInvitationOtp(rawToken: string, ip: string | null): Promise<{ message: string }> {
    this.assertEnabled();
    const invitation = await this.repository.findInvitationByTokenHash(hashToken(rawToken.trim()));
    this.assertInvitationUsable(invitation);
    if (
      await this.repository.hasActiveAccountForTeacher(
        invitation.teacher_id,
        this.line.messagingChannelId,
      )
    ) {
      throw new ConflictException(
        'บัญชีนี้เชื่อม LINE แล้ว หากต้องการเปลี่ยนกรุณาติดต่อผู้ดูแลระบบ',
      );
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.otpStore.issue(invitationOtpKey(invitation.id), code);
    await this.emailService.sendOTP(
      invitation.email,
      code,
      Math.floor(this.auth.otpTtlSeconds / 60),
    );
    await this.auditLog.record({
      actorUserId: null,
      actorLabel: 'line-invitation',
      action: 'TEACHER_ACCESS_OTP_REQUEST',
      targetType: 'teacher_line_invitations',
      targetId: invitation.id,
      metadata: { via: 'LINE_INVITATION', schoolId: invitation.school_id },
      ip,
    });
    return { message: 'ส่งรหัสยืนยันไปยังอีเมลที่ลงทะเบียนแล้ว' };
  }

  async verifyInvitationOtp(
    rawToken: string,
    code: string,
    ip: string | null,
  ): Promise<{ bindingToken: string; teacherName: string }> {
    this.assertEnabled();
    const invitation = await this.repository.findInvitationByTokenHash(hashToken(rawToken.trim()));
    this.assertInvitationUsable(invitation);
    const outcome = await this.otpStore.verify(invitationOtpKey(invitation.id), code.trim());
    if (outcome !== 'ok') {
      await this.auditLog.record({
        actorUserId: null,
        actorLabel: 'line-invitation',
        action: 'TEACHER_ACCESS_OTP_FAILED',
        targetType: 'teacher_line_invitations',
        targetId: invitation.id,
        metadata: { via: 'LINE_INVITATION', outcome, schoolId: invitation.school_id },
        ip,
      });
      throw new BadRequestException('รหัสยืนยันไม่ถูกต้องหรือหมดอายุแล้ว');
    }
    if (
      await this.repository.hasActiveAccountForTeacher(
        invitation.teacher_id,
        this.line.messagingChannelId,
      )
    ) {
      throw new ConflictException(
        'บัญชีนี้เชื่อม LINE แล้ว หากต้องการเปลี่ยนกรุณาติดต่อผู้ดูแลระบบ',
      );
    }
    return {
      bindingToken: await this.sessionStore.createBindingSession({
        teacherId: invitation.teacher_id,
        invitationId: invitation.id,
      }),
      teacherName: `${invitation.first_name} ${invitation.last_name}`.trim(),
    };
  }

  /**
   * Step 1. Emails a code to the address the teacher typed. The response never
   * varies, so a caller learns nothing from it.
   */
  async requestOtp(
    email: string,
    ip: string | null,
    groupToken: string,
  ): Promise<{ message: string }> {
    this.assertEnabled();
    const invitation = await this.assertGroupInvitationActive(groupToken);
    const teacher = await this.repository.findActiveTeacherByEmail(email, invitation.schoolId);
    if (!teacher) {
      // Logged so a burst of attempts against unknown addresses is still visible.
      this.logger.warn('LINE link OTP requested for an address with no active teacher');
      return { message: GENERIC_OTP_REQUEST_MESSAGE };
    }

    try {
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      await this.otpStore.issue(otpKey(teacher.teacher_id), code);
      await this.emailService.sendOTP(
        teacher.email,
        code,
        Math.floor(this.auth.otpTtlSeconds / 60),
      );
      await this.auditLog.record({
        actorUserId: null,
        actorLabel: 'line-link',
        action: 'TEACHER_ACCESS_OTP_REQUEST',
        targetType: 'teachers',
        targetId: teacher.teacher_id,
        metadata: { via: 'LINE_LINK' },
        ip,
      });
    } catch {
      // Keep the public response indistinguishable from an unknown address.
      // Operational failures remain visible in server logs without exposing
      // the address or proving that a teacher account exists.
      this.logger.error('LINE link OTP delivery failed');
    }
    return { message: GENERIC_OTP_REQUEST_MESSAGE };
  }

  /**
   * Step 2. A correct code proves the caller controls that teacher's mailbox and
   * yields the short-lived session the LINE sign-in is allowed to attach to.
   */
  async verifyOtp(
    email: string,
    code: string,
    ip: string | null,
    groupToken: string,
  ): Promise<{ bindingToken: string; teacherName: string }> {
    this.assertEnabled();
    const invitation = await this.assertGroupInvitationActive(groupToken);
    const teacher = await this.repository.findActiveTeacherByEmail(email, invitation.schoolId);
    if (!teacher) {
      // Same message as a wrong code: the pair is either right or it is not.
      throw new BadRequestException(GENERIC_OTP_VERIFY_MESSAGE);
    }

    const outcome = await this.otpStore.verify(otpKey(teacher.teacher_id), code.trim());
    if (outcome !== 'ok') {
      try {
        await this.auditLog.record({
          actorUserId: null,
          actorLabel: 'line-link',
          action: 'TEACHER_ACCESS_OTP_FAILED',
          targetType: 'teachers',
          targetId: teacher.teacher_id,
          metadata: { via: 'LINE_LINK', outcome },
          ip,
        });
      } catch {
        this.logger.error('LINE link OTP failure audit failed');
      }
      throw new BadRequestException(GENERIC_OTP_VERIFY_MESSAGE);
    }

    if (
      await this.repository.hasActiveAccountForTeacher(
        teacher.teacher_id,
        this.line.messagingChannelId,
      )
    ) {
      throw new ConflictException(
        'บัญชีนี้เชื่อม LINE แล้ว หากต้องการเปลี่ยนกรุณาติดต่อผู้ดูแลระบบ',
      );
    }

    return {
      bindingToken: await this.sessionStore.createBindingSession({
        teacherId: teacher.teacher_id,
        schoolId: invitation.schoolId,
      }),
      teacherName: `${teacher.first_name} ${teacher.last_name}`.trim(),
    };
  }

  async verifyAraId(
    groupToken: string,
    araIdProfileId: string,
  ): Promise<{ bindingToken: string; teacherName: string }> {
    this.assertEnabled();
    const invitation = await this.assertGroupInvitationActive(groupToken);
    const citizenId = await this.araIdService.getVerifiedIdentityNumber(araIdProfileId);
    const teacher = await this.repository.findActiveTeacherByCitizenId(
      citizenId,
      invitation.schoolId,
    );
    if (!teacher) throw new BadRequestException('ไม่พบข้อมูลครูที่ตรงกับ AraID ในโรงเรียนนี้');
    if (
      await this.repository.hasActiveAccountForTeacher(
        teacher.teacher_id,
        this.line.messagingChannelId,
      )
    ) {
      throw new ConflictException(
        'บัญชีนี้เชื่อม LINE แล้ว หากต้องการเปลี่ยนกรุณาติดต่อผู้ดูแลระบบ',
      );
    }
    const bindingToken = await this.sessionStore.createBindingSession({
      teacherId: teacher.teacher_id,
      schoolId: invitation.schoolId,
    });
    await this.auditLog.record({
      actorUserId: null,
      actorLabel: 'line-link',
      action: 'TEACHER_ACCESS_ARAID_VERIFY',
      targetType: 'teachers',
      targetId: teacher.teacher_id,
      metadata: { via: 'LINE_LINK', schoolId: invitation.schoolId, authMethod: 'ARAID' },
      ip: null,
    });
    return {
      bindingToken,
      teacherName: `${teacher.first_name} ${teacher.last_name}`.trim(),
    };
  }

  async createAraIdChallenge(groupToken: string) {
    this.assertEnabled();
    const invitation = await this.assertGroupInvitationActive(groupToken);
    const challenge = await this.araIdChallengeStore.create({
      invitationId: invitation.id,
      schoolId: invitation.schoolId,
      schoolName: invitation.schoolName,
    });
    return this.presentAraIdChallenge(challenge.token, challenge);
  }

  async getAraIdChallenge(challengeToken: string) {
    this.assertEnabled();
    const challenge = await this.readActiveAraIdChallenge(challengeToken);
    return this.presentAraIdChallenge(challengeToken, challenge);
  }

  async beginAraIdChallenge(challengeToken: string) {
    this.assertEnabled();
    await this.readActiveAraIdChallenge(challengeToken);
    const authorization = await this.araIdChallengeStore.claim(challengeToken);
    if (!authorization) throw new GoneException('คำขอยืนยัน AraID ถูกเปิดใช้หรือหมดอายุแล้ว');
    return {
      authorizationToken: authorization.authorizationToken,
      expiresAt: new Date(authorization.expiresAt),
    };
  }

  async approveAraIdChallenge(authorizationToken: string, araIdProfileId: string): Promise<void> {
    this.assertEnabled();
    const challenge = await this.araIdChallengeStore.readAuthorization(authorizationToken);
    if (!challenge) throw new GoneException('การยืนยัน AraID หมดอายุแล้ว');
    const active = await this.sessionStore.readActiveGroupInvitation(challenge.schoolId);
    if (
      !active ||
      active.id !== challenge.invitationId ||
      active.startsAt > Date.now() ||
      active.expiresAt <= Date.now()
    ) {
      throw new GoneException('ลิงก์ยืนยัน LINE ถูกปิดหรือหมดอายุแล้ว');
    }
    const citizenId = await this.araIdService.getVerifiedIdentityNumber(araIdProfileId);
    const teacher = await this.repository.findActiveTeacherByCitizenId(
      citizenId,
      challenge.schoolId,
    );
    if (!teacher) throw new BadRequestException('ไม่พบข้อมูลครูที่ตรงกับ AraID ในโรงเรียนนี้');
    if (
      await this.repository.hasActiveAccountForTeacher(
        teacher.teacher_id,
        this.line.messagingChannelId,
      )
    ) {
      throw new ConflictException(
        'บัญชีนี้เชื่อม LINE แล้ว หากต้องการเปลี่ยนกรุณาติดต่อผู้ดูแลระบบ',
      );
    }
    const bindingToken = await this.sessionStore.createBindingSession({
      teacherId: teacher.teacher_id,
      schoolId: challenge.schoolId,
    });
    const approved = await this.araIdChallengeStore.approveAuthorization(authorizationToken, {
      bindingToken,
      teacherName: `${teacher.first_name} ${teacher.last_name}`.trim(),
    });
    if (!approved) throw new GoneException('คำขอยืนยัน AraID ถูกใช้หรือหมดอายุแล้ว');
  }

  async pollAraIdChallenge(challengeToken: string) {
    this.assertEnabled();
    const challenge = await this.readActiveAraIdChallenge(challengeToken);
    if (challenge.status === 'PENDING') return { status: 'PENDING' as const };
    if (challenge.status === 'CLAIMED') {
      return {
        status: 'IN_PROGRESS' as const,
        expiresAt: new Date(challenge.expiresAt).toISOString(),
      };
    }
    const approved = await this.araIdChallengeStore.consumeApproved(challengeToken);
    if (!approved?.bindingToken || !approved.teacherName) {
      throw new GoneException('คำขอยืนยัน AraID ถูกใช้แล้ว');
    }
    return {
      status: 'APPROVED' as const,
      bindingToken: approved.bindingToken,
      teacherName: approved.teacherName,
    };
  }

  private async presentAraIdChallenge(
    challengeToken: string,
    challenge: Omit<StoredTeacherLineAraIdChallenge, 'token'>,
  ) {
    const verificationUrl = new URL('/line-link/araid-authorize', this.frontendBaseUrl());
    verificationUrl.hash = `challenge=${encodeURIComponent(challengeToken)}`;
    const qrDataUrl = await QRCode.toDataURL(verificationUrl.toString(), {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
    });
    return {
      challengeToken,
      verificationUrl: verificationUrl.toString(),
      qrDataUrl,
      referenceCode: challenge.referenceCode,
      expiresAt: new Date(challenge.entryExpiresAt).toISOString(),
      schoolName: challenge.schoolName,
      status: challenge.status,
    };
  }

  private async readActiveAraIdChallenge(challengeToken: string) {
    const challenge = await this.araIdChallengeStore.read(challengeToken);
    if (!challenge) throw new GoneException('คำขอยืนยัน AraID หมดอายุแล้ว');
    const active = await this.sessionStore.readActiveGroupInvitation(challenge.schoolId);
    if (
      !active ||
      active.id !== challenge.invitationId ||
      active.startsAt > Date.now() ||
      active.expiresAt <= Date.now()
    ) {
      throw new GoneException('ลิงก์ยืนยัน LINE ถูกปิดหรือหมดอายุแล้ว');
    }
    return challenge;
  }

  /**
   * Step 3. Where to send the browser next. The provider only ever sees a random
   * `state`; the teacher's identity stays on our side of the redirect.
   */
  async startAuthorization(bindingToken: string): Promise<string> {
    this.assertEnabled();
    const session = await this.sessionStore.readBindingSession(bindingToken);
    if (!session) {
      throw new BadRequestException('การยืนยันหมดอายุแล้ว กรุณายืนยันอีเมลใหม่อีกครั้ง');
    }
    const nonce = randomUUID();
    const state = await this.sessionStore.createOAuthState({
      bindingToken,
      teacherId: session.teacherId,
      nonce,
    });
    return this.messaging.buildAuthorizationUrl({ state, nonce, promptAddFriend: true });
  }

  /**
   * Step 4. Turns the provider's redirect into a stored binding. Returns an
   * outcome rather than throwing, because the caller is a browser mid-redirect
   * that has to land on a page either way.
   */
  async completeAuthorization(
    code: string,
    state: string,
    ip: string | null,
  ): Promise<{ outcome: TeacherLineLinkOutcome; addContactUrl: string | null }> {
    this.assertEnabled();
    const pending = await this.sessionStore.consumeOAuthState(state);
    if (!pending || !code) {
      return { outcome: 'EXPIRED', addContactUrl: null };
    }
    // The binding session is intentionally NOT consumed yet: a teacher who has
    // not added the account needs to add it and retry without redoing the OTP.
    const session = await this.sessionStore.readBindingSession(pending.bindingToken);
    if (!session || session.teacherId !== pending.teacherId) {
      return { outcome: 'EXPIRED', addContactUrl: null };
    }

    let identity;
    let friendState;
    try {
      const result = await this.messaging.completeAuthorization(code, pending.nonce);
      identity = result.identity;
      friendState = result.friendState;
    } catch {
      this.logger.error('LINE link callback failed at the messaging provider');
      return { outcome: 'FAILED', addContactUrl: null };
    }

    if (friendState !== 'FRIEND') {
      // Not recorded as verified: a binding that cannot be messaged is worse
      // than none, because the teacher table would claim they are reachable.
      return { outcome: 'NOT_FRIEND', addContactUrl: this.messaging.buildAddContactUrl() };
    }

    const channelId = this.line.messagingChannelId;
    let outcome: TeacherLineLinkOutcome;
    try {
      outcome = await this.repository.withTransaction(async (queryRunner) => {
        const invitation = session.invitationId
          ? await this.repository.findInvitationById(session.invitationId, queryRunner, true)
          : null;
        if (session.invitationId) {
          this.assertInvitationUsable(invitation);
          if (invitation.teacher_id !== session.teacherId) {
            throw new GoneException('ลิงก์ยืนยัน LINE ไม่ถูกต้องหรือหมดอายุแล้ว');
          }
        }
        if (
          session.schoolId &&
          !(await this.repository.hasActiveTeacherMembership(
            session.teacherId,
            queryRunner,
            session.schoolId,
          ))
        ) {
          throw new GoneException('ข้อมูลครูไม่อยู่ในขอบเขตโรงเรียนของลิงก์นี้แล้ว');
        }
        let heldByOther = await this.repository.findActiveAccountByProviderUser(
          channelId,
          identity.providerUserId,
          queryRunner,
        );
        let linkOutcome: 'SUCCESS' | 'TEACHER_ALREADY_LINKED' | 'ALREADY_LINKED_TO_ANOTHER_TEACHER';
        if (heldByOther && heldByOther.teacher_id !== session.teacherId) {
          const ownerStillActive = await this.repository.hasActiveTeacherMembership(
            heldByOther.teacher_id,
            queryRunner,
          );
          if (ownerStillActive) {
            linkOutcome = 'ALREADY_LINKED_TO_ANOTHER_TEACHER';
          } else {
            await this.repository.unlinkAccount(
              heldByOther.id,
              'STALE_INACTIVE_TEACHER_BINDING',
              queryRunner,
            );
            heldByOther = null;
            linkOutcome = 'SUCCESS';
          }
        } else {
          linkOutcome = 'SUCCESS';
        }

        if (linkOutcome === 'SUCCESS') {
          const current = await this.repository.findActiveAccountForTeacher(
            session.teacherId,
            channelId,
            queryRunner,
          );
          if (current) {
            linkOutcome = 'TEACHER_ALREADY_LINKED';
          } else {
            await this.repository.insertAccount(
              {
                teacherId: session.teacherId,
                providerChannelId: channelId,
                providerUserId: identity.providerUserId,
                displayName: identity.displayName,
                friendState,
              },
              queryRunner,
            );
            if (invitation) {
              const consumed = await this.repository.consumeInvitation(invitation.id, queryRunner);
              if (!consumed) {
                throw new GoneException('ลิงก์ยืนยัน LINE ไม่ถูกต้องหรือหมดอายุแล้ว');
              }
            }
          }
        }

        // Binding and its audit record commit or roll back together. Otherwise an
        // audit outage could leave an unaudited recipient while the browser sees
        // a failed callback and retries the operation.
        await this.auditLog.recordAtomic(
          {
            actorUserId: null,
            actorLabel: 'line-link',
            action:
              linkOutcome === 'SUCCESS'
                ? 'TEACHER_MESSAGING_LINK'
                : 'TEACHER_MESSAGING_LINK_DENIED',
            targetType: 'teachers',
            targetId: session.teacherId,
            metadata: { provider: 'LINE', outcome: linkOutcome },
            ip,
          },
          queryRunner,
        );
        return linkOutcome;
      });
    } catch (error) {
      if (error instanceof GoneException) {
        return { outcome: 'EXPIRED', addContactUrl: null };
      }
      this.logger.error('LINE link callback transaction failed');
      return { outcome: 'FAILED', addContactUrl: null };
    }

    if (outcome === 'SUCCESS' || outcome === 'TEACHER_ALREADY_LINKED') {
      await this.sessionStore.clearBindingSession(pending.bindingToken);
    }
    return {
      outcome,
      addContactUrl:
        outcome === 'ALREADY_LINKED_TO_ANOTHER_TEACHER'
          ? this.messaging.buildAddContactUrl()
          : null,
    };
  }

  /**
   * Applies inbound follow/unfollow events. Without this the teacher table would
   * keep claiming someone is reachable long after they blocked the account —
   * the friendship reading taken at sign-in is only true for that moment.
   *
   * Returns quietly for accounts we do not know: the official account can be
   * added by anyone, most of whom are not teachers.
   */
  async applyWebhookEvents(rawBody: Buffer | string, signature: string): Promise<void> {
    if (!this.messaging.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('ลายเซ็นของ webhook ไม่ถูกต้อง');
    }
    const events = parseWebhookEvents(rawBody);
    for (const event of events) {
      const friendState = event.type === 'follow' ? 'FRIEND' : 'NOT_FRIEND';
      // LINE reports "blocked us" and "deleted the account" as the same
      // unfollow event, so BLOCKED can never be told apart from NOT_FRIEND.
      const updated = await this.repository.updateFriendStateByProviderUser(
        this.line.messagingChannelId,
        event.userId,
        friendState,
      );
      if (updated > 0) {
        this.logger.log(`LINE ${event.type} applied to a linked teacher account`);
      }
    }
  }

  /**
   * Records that the provider refused a delivery to this account. Called by the
   * send path so a rejection updates the table immediately rather than waiting
   * for an unfollow webhook that may never arrive.
   */
  async markUnreachable(providerUserId: string): Promise<void> {
    await this.repository.updateFriendStateByProviderUser(
      this.line.messagingChannelId,
      providerUserId,
      'NOT_FRIEND',
    );
  }

  async unlinkActiveAccountForTeacher(
    teacherId: string,
    reason: string,
    updatedBy: number,
    queryRunner: QueryRunner,
  ): Promise<boolean> {
    return await this.repository.unlinkActiveAccountForTeacher(
      teacherId,
      reason,
      updatedBy,
      queryRunner,
    );
  }

  /** Where the browser lands after the callback, with only non-secret hints. */
  buildResultUrl(outcome: TeacherLineLinkOutcome, addContactUrl: string | null): string {
    const url = new URL('/line-link/result', this.frontendBaseUrl());
    url.searchParams.set('status', outcome.toLowerCase());
    if (addContactUrl) url.searchParams.set('addUrl', addContactUrl);
    return url.toString();
  }
}

interface WebhookFriendshipEvent {
  type: 'follow' | 'unfollow';
  userId: string;
}

/**
 * Only follow/unfollow are of interest; the account also receives messages,
 * joins and postbacks that this feature has no opinion about. A malformed body
 * yields no events rather than an error, because a webhook that keeps failing
 * gets disabled by the provider.
 */
function parseWebhookEvents(rawBody: Buffer | string): WebhookFriendshipEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
  } catch {
    return [];
  }
  const events = (parsed as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  return events.flatMap((event) => {
    const type = (event as { type?: unknown })?.type;
    const userId = (event as { source?: { userId?: unknown } })?.source?.userId;
    if ((type !== 'follow' && type !== 'unfollow') || typeof userId !== 'string' || !userId) {
      return [];
    }
    return [{ type, userId }];
  });
}
