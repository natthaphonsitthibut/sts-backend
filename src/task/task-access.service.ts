import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';
import { authConfig } from '../config/auth.config';
import { clean, hashToken, maskEmailAddress } from '../common/utils/helpers';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EmailService } from '../common/email/email.service';
import { TaskPolicyService } from './task-policy.service';
import type { ActorContext } from './task.types';
import { TaskRepository } from './task.repository';
import {} from '../common/pagination/pagination.util';
import { MagicSessionStoreService } from '../auth/magic-session-store.service';
import { AraIdChallengeStore, type AraIdChallengeScope } from '../araid/araid-challenge.store';
import { AraIdService } from '../araid/araid.service';

/** Every AraID challenge in this service belongs to a follow-up/assistance link. */
const ARAID_SCOPE: AraIdChallengeScope = 'task-link';

function maskName(name: string | null | undefined): string {
  if (!name) return '-';
  const parts = name.trim().split(/\s+/);
  return parts
    .map((part) => {
      if (part.length <= 2) return part[0] + '*';
      return part[0] + '*'.repeat(part.length - 2) + part[part.length - 1];
    })
    .join(' ');
}

@Injectable()
export class TaskAccessService {
  private readonly logger = new Logger(TaskAccessService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
    private readonly emailService: EmailService,
    private readonly auditLog: AuditLogService,
    @Inject(authConfig.KEY)
    private readonly authRuntimeConfig: ConfigType<typeof authConfig>,
    private readonly magicSessionStore: MagicSessionStoreService,
    private readonly araIdChallengeStore: AraIdChallengeStore,
    private readonly araIdService: AraIdService,
  ) {}

  /**
   * A task link can be verified with AraID instead of the emailed OTP. The
   * identity that may approve it is the teacher the link was issued to — read
   * through `assigned_teacher_id`, never the denormalised email.
   */
  async createAraIdChallenge(token: string, baseUrl: string) {
    const link = await this.findUsableLinkForVerification(token);
    const challenge = await this.araIdChallengeStore.create(ARAID_SCOPE, String(link.id));
    const verificationUrl = new URL('/araid/authorize', baseUrl);
    verificationUrl.hash = `challenge=${encodeURIComponent(challenge.token)}&scope=${ARAID_SCOPE}`;
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

  async beginTaskAraIdChallenge(challengeToken: string, existingAuthorizationToken?: string) {
    if (existingAuthorizationToken) {
      const resumed = await this.araIdChallengeStore.resume(
        ARAID_SCOPE,
        challengeToken,
        existingAuthorizationToken,
      );
      if (resumed) {
        return { authorizationToken: resumed.authorizationToken, expiresAt: resumed.expiresAt };
      }
    }
    const challenge = await this.araIdChallengeStore.read(ARAID_SCOPE, challengeToken);
    if (!challenge) throw new GoneException('คำขอยืนยัน AraID หมดอายุแล้ว');
    const authorization = await this.araIdChallengeStore.claim(ARAID_SCOPE, challengeToken);
    if (!authorization) throw new GoneException('คำขอยืนยัน AraID ถูกเปิดใช้หรือหมดอายุแล้ว');
    return authorization;
  }

  async approveTaskAraIdChallenge(
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
      throw new UnauthorizedException('กรุณากรอก PIN AraID ใหม่เพื่อยืนยันลิงก์นี้');
    }
    await this.assertAraIdIdentityMatchesLink(authorization.challenge.subjectId, araIdProfileId);
    if (!(await this.araIdChallengeStore.approveAuthorization(ARAID_SCOPE, authorizationToken))) {
      throw new GoneException('คำขอยืนยัน AraID ถูกใช้หรือหมดอายุแล้ว');
    }
    await this.auditLog.record({
      actorUserId: null,
      actorLabel: null,
      action: 'TASK_LINK_ARAID_VERIFY',
      targetType: 'task_links',
      targetId: authorization.challenge.subjectId,
      metadata: { authMethod: 'ARAID_QR' },
      ip: null,
    });
    return { success: true, data: { approved: true } };
  }

  async pollTaskAraIdChallenge(challengeToken: string) {
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
    const sessionToken = await this.magicSessionStore.issue(consumed.subjectId);
    return { success: true, data: { status: 'APPROVED' as const, sessionToken } };
  }

  private async findUsableLinkForVerification(token: string): Promise<Record<string, unknown>> {
    const trimmed = token.trim();
    if (trimmed.length < 32 || trimmed.length > 256) {
      throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
    }
    const link = await this.taskRepository.findTaskLinkByTokenHash(hashToken(trimmed));
    if (!link) throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
    if (new Date(String(link.expires_at)) < new Date()) {
      throw new GoneException('ลิงก์นี้หมดอายุแล้ว');
    }
    if (Number(link.admin_locked) === 1) {
      throw new ForbiddenException('ลิงก์นี้ถูกระงับการใช้งาน');
    }
    if (link.status === 'COMPLETED') {
      throw new ConflictException('ลิงก์นี้ถูกบันทึกเรียบร้อยแล้ว');
    }
    return link;
  }

  /**
   * The AraID-verified citizen id must belong to the teacher the link was
   * issued to. A link with no bound teacher (issued before that column existed)
   * cannot be verified this way and stays on the emailed OTP.
   */
  private async assertAraIdIdentityMatchesLink(
    linkId: string,
    araIdProfileId: string,
  ): Promise<void> {
    const identity = await this.taskRepository.findTaskLinkAraIdIdentity(linkId);
    const rawCitizenId = identity?.teacher_citizen_id;
    const expected = typeof rawCitizenId === 'string' ? (clean(rawCitizenId) ?? '') : '';
    if (!/^\d{13}$/.test(expected)) {
      throw new ConflictException(
        'ครูผู้รับมอบหมายยังไม่มีเลขบัตรประชาชนในระบบ กรุณายืนยันผ่านอีเมลแทน',
      );
    }
    const verified = await this.araIdService.getVerifiedIdentityNumber(araIdProfileId);
    const expectedBuffer = Buffer.from(expected);
    const verifiedBuffer = Buffer.from(verified.trim());
    const matches =
      expectedBuffer.length === verifiedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, verifiedBuffer);
    if (!matches) {
      throw new ForbiddenException('AraID นี้ไม่ตรงกับครูผู้รับมอบหมายของลิงก์');
    }
  }

  async getTaskByToken(token: string, sessionToken?: string) {
    const tokenHash = hashToken(token);
    const link = await this.taskRepository.findTaskLinkByTokenHash(tokenHash);
    if (!link) {
      return null;
    }

    if (new Date(String(link.expires_at)) < new Date()) {
      return { error: 'Link expired', status: 'EXPIRED' };
    }

    if (link.admin_locked) {
      return {
        error: 'Link is disabled by admin',
        status: 'ADMIN_LOCKED',
        reason: link.admin_lock_reason || null,
      };
    }

    if (link.opens_at && new Date(link.opens_at as string) > new Date()) {
      return { error: 'Link not yet open', status: 'SCHEDULED' };
    }

    if (link.status === 'COMPLETED') {
      return { error: 'Task already completed', status: 'COMPLETED' };
    }

    const sessionVerified = !link.otp_verified
      ? await this.magicSessionStore.isVerified(String(link.id), sessionToken)
      : false;

    // Every public link proves identity before it hands anything over — one
    // rule shared with the teacher access link and the LINE verification link,
    // both of which gate unconditionally.
    //
    // It deliberately does NOT depend on the mail transport. AraID is the other
    // way through this gate, so tying the requirement to SMTP would silently
    // drop a deployment without email configured to single-factor links that
    // hand a minor's name, address and phone to anyone holding the URL. Whether
    // the assigned teacher actually has a citizen id or a reachable mailbox is
    // the school's data-entry problem: the attempt fails with a clear message
    // instead of the gate disappearing.
    const authRequired = !link.otp_verified && !sessionVerified;

    const result: Record<string, unknown> = {
      task_id: link.task_id,
      link_id: link.id,
      type: link.task_type,
      task_type: link.task_type,
      otp_verified: link.otp_verified,
      assigned_to_email: link.assigned_to_email,
      target_grade: link.target_grade,
      target_room: link.target_room,
      target_school_id: link.target_school_id,
      assigned_to_name: link.current_assignee_name || link.assigned_to_name,
      assigned_to_first_name: link.assigned_to_first_name ?? null,
      assigned_to_last_name: link.assigned_to_last_name ?? null,
      status: link.status,
      opens_at: link.opens_at ?? null,
      expires_at: link.expires_at,
      assignment_note: link.assignment_note ?? null,
      created_at: link.created_at ?? null,
      subject: link.subject,
      school_name: link.school_name,
      auth_required: authRequired,
      login_permissions: link.login_permissions || [],
      login_data_scope: link.login_data_scope || {},
    };

    if (link.task_type === 'ASSIST') {
      // The measures were committed at assignment time; the report form shows
      // them read-only rather than letting the reporter re-pick.
      result.assistance_measures = await this.taskRepository.listTaskAssistanceMeasures(
        String(link.task_id),
      );
      result.assistance_measure_detail = link.assistance_measure_detail ?? null;
    }

    if (link.task_type === 'VISIT' || link.task_type === 'ASSIST') {
      const caseData = await this.taskRepository.findCaseByTaskId(String(link.task_id));

      if (result.auth_required) {
        result.student_name = maskName(
          typeof caseData?.student_name === 'string' ? caseData.student_name : null,
        );
        result.student_school = maskName(
          typeof caseData?.student_school === 'string' ? caseData.student_school : null,
        );
        result.student_address = '*** (กรุณายืนยันตัวตน) ***';
        result.student_phone = null;
        result.reason_flagged = '*** (กรุณายืนยันตัวตน) ***';
        result.student_lat = null;
        result.student_lng = null;
      } else {
        result.student_name = caseData?.student_name || null;
        result.student_school = caseData?.student_school || null;
        result.student_address = caseData?.student_address || null;
        result.student_phone = caseData?.student_phone || null;
        result.address_line = caseData?.address_line || null;
        result.address_province = caseData?.address_province || null;
        result.address_district = caseData?.address_district || null;
        result.address_sub_district = caseData?.address_sub_district || null;
        result.postal_code = caseData?.postal_code || null;
        result.student_lat = caseData?.student_lat || null;
        result.student_lng = caseData?.student_lng || null;
        result.reason_flagged = caseData?.reason_flagged || null;
        result.case_status = caseData?.status || null;
        // The card header reuses the composed workflow label so the guest form
        // shows one of the five statuses (`รอติดตาม : ให้ความช่วยเหลือ`) rather
        // than inventing a status of its own.
        result.case_display_status_label = caseData?.display_status_label || null;
        result.academic_year = caseData?.academic_year || null;
        result.semester = caseData?.semester || null;
        result.student_grade = caseData?.grade || null;
        result.student_room = caseData?.room || null;
        const caseId = Number(caseData?.id);
        result.contact_channels = Number.isInteger(caseId)
          ? (await this.taskRepository.listPublicCaseContactChannels(caseId)).map((row) => ({
              contact_kind: row.contact_kind === 'STUDENT' ? 'STUDENT' : 'GUARDIAN',
              relation: typeof row.relation === 'string' ? row.relation : null,
              relation_note: typeof row.relation_note === 'string' ? row.relation_note : null,
              full_name: typeof row.full_name === 'string' ? row.full_name : null,
              phone: typeof row.phone === 'string' ? row.phone : null,
              is_primary: row.is_primary === true,
            }))
          : [];
        result.follow_up_history = Number.isInteger(caseId)
          ? (await this.taskRepository.listPublicCaseFollowUpHistory(caseId, 5)).map((row) => ({
              assigned_to_name:
                typeof row.assigned_to_name === 'string' ? row.assigned_to_name : null,
              visited_at: row.visited_at ?? null,
              submitted_at: row.submitted_at ?? null,
              assignment_starts_at: row.assignment_starts_at ?? null,
              assignment_ends_at: row.assignment_ends_at ?? null,
              assignment_note: typeof row.assignment_note === 'string' ? row.assignment_note : null,
              cause_detail: typeof row.cause_detail === 'string' ? row.cause_detail : null,
              follow_up_assessment_label:
                typeof row.follow_up_assessment_label === 'string'
                  ? row.follow_up_assessment_label
                  : null,
              exception_label: typeof row.exception_label === 'string' ? row.exception_label : null,
            }))
          : [];
      }
    }

    return result;
  }

  async requestOtp(token: string) {
    const tokenHash = hashToken(token);
    const link = await this.taskRepository.findOtpLinkByTokenHash(tokenHash);

    if (!link) {
      throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
    }

    const email = typeof link.assigned_to_email === 'string' ? link.assigned_to_email.trim() : '';
    if (!email) {
      throw new BadRequestException('ลิงก์นี้ไม่มีอีเมลผู้ใช้งานที่เชื่อมโยง');
    }

    const otpTtlSeconds = this.authRuntimeConfig.otpTtlSeconds;
    const otp = crypto.randomInt(100000, 1000000).toString();
    const expiresAt = new Date(Date.now() + otpTtlSeconds * 1000);

    await this.taskRepository.updateLinkOtp({
      linkId: String(link.id),
      otpCode: otp,
      otpExpiresAt: expiresAt.toISOString(),
    });

    try {
      await this.emailService.sendOTP(email, otp, Math.round(otpTtlSeconds / 60));
      return {
        success: true,
        message: 'OTP sent successfully',
        expires_at: expiresAt.toISOString(),
        method: 'EMAIL',
        maskedEmail: maskEmailAddress(email),
        expiresAt: expiresAt.toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send OTP: ${message}`);
      throw err;
    }
  }

  async verifyOtp(token: string, otp: string) {
    // Use HTTP exceptions (not plain Error) so a wrong/expired code returns a
    // 4xx with a readable message instead of a 500 Internal Server Error.
    if (!otp) {
      throw new BadRequestException('กรุณากรอกรหัส OTP');
    }

    const tokenHash = hashToken(token);

    // The whole check runs in one transaction with the row locked (FOR UPDATE)
    // so concurrent guesses on the same link are serialized — without this they
    // could each read the row before the lock is set and slip past the cap. The
    // transaction must COMMIT even on a wrong guess (to persist the incremented
    // attempt), so the outcome is returned and the 4xx is thrown afterwards
    // rather than thrown inside (which would roll the increment back).
    const result = await this.taskRepository.withTransaction(async (executor) => {
      const link = await this.taskRepository.findOtpLinkByTokenHashForUpdate(tokenHash, executor);
      if (!link) {
        return { outcome: 'not_found' as const };
      }

      // Brute-force lockout: a link that has exhausted its OTP attempts stays
      // locked until the cool-down passes (or a new OTP is requested, which
      // resets the counter). Checked before comparing the code so a locked link
      // cannot be probed further.
      const lockedRaw = link.otp_locked_until as string | Date | null;
      const lockedUntil = lockedRaw ? new Date(lockedRaw) : null;
      if (lockedUntil && lockedUntil > new Date()) {
        return { outcome: 'locked' as const };
      }

      if (new Date(String(link.otp_expires_at)) < new Date()) {
        return { outcome: 'expired' as const };
      }

      if (!link.otp_code || link.otp_code !== otp) {
        const { lockedUntil: nowLocked } = await this.taskRepository.registerFailedOtpAttempt(
          String(link.id),
          this.authRuntimeConfig.otpMaxAttempts,
          this.authRuntimeConfig.otpLockSeconds,
          executor,
        );
        const justLocked = !!nowLocked && nowLocked > new Date();
        return { outcome: justLocked ? ('locked' as const) : ('wrong' as const) };
      }

      // Correct code — clear the brute-force counter and issue the session.
      await this.taskRepository.clearOtpAttempts(String(link.id), executor);
      return { outcome: 'ok' as const, linkId: String(link.id) };
    });

    if (result.outcome === 'not_found') {
      throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
    }
    if (result.outcome === 'locked') {
      throw new HttpException(
        'ลองรหัส OTP ผิดหลายครั้งเกินไป กรุณาขอรหัสใหม่หรือลองอีกครั้งภายหลัง',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (result.outcome === 'expired') {
      throw new BadRequestException('รหัส OTP หมดอายุ กรุณาขอรหัสใหม่');
    }
    if (result.outcome === 'wrong') {
      throw new BadRequestException('รหัส OTP ไม่ถูกต้อง');
    }
    if (!result.linkId) {
      throw new InternalServerErrorException('ไม่สามารถยืนยัน OTP ได้');
    }

    const sessionToken = await this.magicSessionStore.issue(result.linkId);

    return { success: true, session_token: sessionToken };
  }

  async adminLockLink(
    actor: ActorContext | undefined,
    linkId: string,
    action: 'lock' | 'unlock',
    reason?: string,
  ) {
    try {
      const currentActor = this.taskPolicyService.ensureActor(actor);
      const link = await this.taskRepository.findTaskLinkById(linkId);

      if (!link) {
        throw new Error('Link not found');
      }
      if (link.task_type !== 'VISIT' && link.task_type !== 'ASSIST') {
        throw new Error('Only VISIT and ASSIST links can be changed by admin');
      }
      if (link.status !== 'ACTIVE') {
        throw new Error('Only ACTIVE links can be changed by admin');
      }

      if (
        !this.taskPolicyService.canManageAdminLink(currentActor, {
          task_type: typeof link.task_type === 'string' ? link.task_type : null,
          login_role: typeof link.login_role === 'string' ? link.login_role : null,
          login_data_scope: link.login_data_scope,
          target_school_id: link.target_school_id,
          target_room: link.target_room,
          case_created_by: link.case_created_by,
        })
      ) {
        throw new ForbiddenException('ไม่มีสิทธิ์จัดการลิงก์นี้');
      }

      if (action === 'lock') {
        const normalizedReason = clean(reason);
        if (!normalizedReason) {
          throw new Error('reason is required when locking link');
        }

        await this.taskRepository.updateAdminLockState({
          linkId,
          locked: true,
          reason: normalizedReason,
          lockedAt: new Date().toISOString(),
        });

        await this.auditLog.record({
          actorUserId: resolveAuditActorId(currentActor),
          actorLabel: currentActor.username,
          action: 'LINK_LOCK',
          targetType: 'task_link',
          targetId: linkId,
          metadata: {
            taskType: link.task_type,
            schoolId: link.target_school_id,
            grade: link.target_grade,
            room: link.target_room,
            reason: normalizedReason,
          },
          ip: null,
        });

        return {
          message: 'Link locked by admin',
          link_id: linkId,
          admin_locked: 1,
        };
      }

      await this.taskRepository.updateAdminLockState({
        linkId,
        locked: false,
      });

      await this.auditLog.record({
        actorUserId: resolveAuditActorId(currentActor),
        actorLabel: currentActor.username,
        action: 'LINK_UNLOCK',
        targetType: 'task_link',
        targetId: linkId,
        metadata: {
          taskType: link.task_type,
          schoolId: link.target_school_id,
          grade: link.target_grade,
          room: link.target_room,
        },
        ip: null,
      });

      return {
        message: 'Link unlocked by admin',
        link_id: linkId,
        admin_locked: 0,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`adminLockLink error: ${message}`);
      throw err;
    }
  }

  /**
   * Admin-only link detail by id (not token). Unlike the public token endpoint
   * this returns the link even when it is closed/expired, so the admin detail
   * page can render and manage it. Same scope gate as adminLockLink. Returns an
   * explicit shape (never the raw row) so token_hash / otp are never leaked.
   */
  async getAdminLinkDetail(actor: ActorContext | undefined, linkId: string) {
    try {
      const currentActor = this.taskPolicyService.ensureActor(actor);
      const link = await this.taskRepository.findLinkDetailById(linkId);

      if (!link) {
        throw new NotFoundException('ไม่พบลิงก์');
      }

      if (
        !this.taskPolicyService.canManageAdminLink(currentActor, {
          task_type: typeof link.task_type === 'string' ? link.task_type : null,
          login_role: typeof link.login_role === 'string' ? link.login_role : null,
          login_data_scope: link.login_data_scope,
          target_school_id: link.target_school_id,
          target_room: link.target_room,
          case_created_by: link.case_created_by,
        })
      ) {
        throw new ForbiddenException('ไม่มีสิทธิ์ดูลิงก์นี้');
      }

      const isExpired = new Date(String(link.expires_at)) < new Date();
      const isScheduled = !!link.opens_at && new Date(link.opens_at as string) > new Date();
      const status = isExpired
        ? 'EXPIRED'
        : link.admin_locked
          ? 'LOCKED'
          : isScheduled
            ? 'SCHEDULED'
            : 'ACTIVE';

      return {
        link_id: link.id,
        task_id: link.task_id,
        type: link.task_type,
        task_type: link.task_type,
        status,
        admin_locked: link.admin_locked ? 1 : 0,
        admin_lock_reason: link.admin_lock_reason ?? null,
        magic_link: link.magic_link ?? null,
        expires_at: link.expires_at,
        created_at: link.created_at ?? null,
        first_used_at: link.first_used_at ?? null,
        subject: link.subject ?? null,
        assigned_to_name: link.assigned_to_name ?? null,
        assigned_to_email: link.assigned_to_email ?? null,
        school_name: link.school_name ?? null,
        target_grade: link.target_grade ?? null,
        target_room: link.target_room ?? null,
        target_school_id: link.target_school_id ?? null,
        login_role: link.login_role ?? null,
        login_role_label: link.login_role_label ?? null,
        login_permissions: link.login_permissions ?? [],
        login_data_scope: link.login_data_scope ?? {},
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getAdminLinkDetail error: ${message}`);
      throw err;
    }
  }

  private buildVirtualUserId(linkId: string): number {
    const parsed = Number.parseInt(hashToken(linkId).slice(0, 8), 16);
    return Number.isFinite(parsed) && parsed > 0 ? -parsed : -1;
  }
}
