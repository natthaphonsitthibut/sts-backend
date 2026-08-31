import {
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
import * as QRCode from 'qrcode';
import { clean, hashToken } from '../common/utils/helpers';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TaskPolicyService } from './task-policy.service';
import type { ActorContext } from './task.types';
import { TaskRepository } from './task.repository';
import { MagicSessionStoreService } from '../auth/magic-session-store.service';
import { AraIdChallengeStore, type AraIdChallengeScope } from '../araid/araid-challenge.store';
import { AraIdService } from '../araid/araid.service';
import { GoogleOidcProvider } from '../classroom-attendance-links/google-oidc.provider';
import { googleLoginConfig } from '../config/google-login.config';
import { ScopedGoogleLoginStateStore } from '../google-login/scoped-google-login-state.store';

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

/** Ids arrive from raw rows as `unknown`; compare them as the text they are. */
function toIdentityText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

@Injectable()
export class TaskAccessService {
  private readonly logger = new Logger(TaskAccessService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
    private readonly auditLog: AuditLogService,
    private readonly magicSessionStore: MagicSessionStoreService,
    private readonly araIdChallengeStore: AraIdChallengeStore,
    private readonly araIdService: AraIdService,
    private readonly google: GoogleOidcProvider,
    private readonly googleStates: ScopedGoogleLoginStateStore,
    @Inject(googleLoginConfig.KEY)
    private readonly googleConfig: ConfigType<typeof googleLoginConfig>,
  ) {}

  async startGoogleAuthorization(token: string): Promise<{ authorizationUrl: string }> {
    const link = await this.findUsableLinkForVerification(token);
    const schoolId = Number(link.target_school_id);
    if (!Number.isInteger(schoolId) || schoolId <= 0) {
      throw new ConflictException('ลิงก์นี้ไม่มีโรงเรียนที่ใช้ตรวจสอบตัวตน');
    }
    const login = await this.googleStates.create('task-link', {
      subjectId: String(link.id),
      tokenHash: hashToken(token.trim()),
      schoolId,
    });
    return {
      authorizationUrl: this.google.authorizationUrl(
        login.state,
        login.nonce,
        this.googleConfig.taskCallbackUrl,
      ),
    };
  }

  /**
   * The verified teacher must be the one the task was assigned to.
   *
   * Being a teacher at the link's school was the only test, so any colleague
   * could open a colleague's follow-up and submit a home visit under their
   * name. The assignee is recorded on the link; when it is, it decides. Links
   * with no assignee stay open to the school, which is what an unassigned link
   * is for.
   */
  private assertAssignedTeacher(link: { assigned_teacher_id?: unknown }, teacherId: unknown): void {
    const assignedTeacherId = toIdentityText(link.assigned_teacher_id);
    if (assignedTeacherId === '') return;
    if (assignedTeacherId !== toIdentityText(teacherId)) {
      throw new ForbiddenException('ลิงก์นี้มอบหมายให้ครูอีกคน');
    }
  }

  async completeGoogleAuthorization(code: string, state: string): Promise<string> {
    const login = await this.googleStates.consume('task-link', state);
    if (!login) throw new GoneException('คำขอ Google Login หมดอายุหรือถูกใช้แล้ว');
    const link = await this.taskRepository.findTaskLinkByTokenHash(login.tokenHash);
    this.assertLinkRecordUsable(link);
    if (String(link.id) !== login.subjectId || Number(link.target_school_id) !== login.schoolId) {
      throw new GoneException('ลิงก์งานถูกเปลี่ยนหรือหมดอายุแล้ว');
    }
    const identity = await this.google.exchange(
      code,
      login.nonce,
      this.googleConfig.taskCallbackUrl,
    );
    const teacher = await this.taskRepository.findActiveTeacherInSchoolByEmail(
      identity.email,
      login.schoolId,
    );
    if (!teacher) {
      throw new ForbiddenException('Google นี้ไม่ตรงกับครูที่เปิดใช้งานในโรงเรียนของลิงก์');
    }
    this.assertAssignedTeacher(link, teacher.teacher_id);
    const sessionToken = await this.magicSessionStore.issue(login.subjectId);
    await this.auditLog.record({
      actorUserId: null,
      actorLabel: null,
      action: 'TASK_LINK_GOOGLE_VERIFY',
      targetType: 'task_links',
      targetId: login.subjectId,
      metadata: { authMethod: 'GOOGLE' },
      ip: null,
    });
    return sessionToken;
  }

  async completeDevelopmentGoogleAuthorization(token: string, email: string): Promise<string> {
    const identity = this.google.developmentIdentity(email);
    const link = await this.findUsableLinkForVerification(token);
    const schoolId = Number(link.target_school_id);
    if (!Number.isInteger(schoolId) || schoolId <= 0) {
      throw new ConflictException('ลิงก์นี้ไม่มีโรงเรียนที่ใช้ตรวจสอบตัวตน');
    }
    const teacher = await this.taskRepository.findActiveTeacherInSchoolByEmail(
      identity.email,
      schoolId,
    );
    if (!teacher) {
      throw new ForbiddenException('อีเมลนี้ไม่ตรงกับครูที่เปิดใช้งานในโรงเรียนของลิงก์');
    }
    this.assertAssignedTeacher(link, teacher.teacher_id);
    const sessionToken = await this.magicSessionStore.issue(String(link.id));
    await this.auditLog.record({
      actorUserId: null,
      actorLabel: null,
      action: 'TASK_LINK_GOOGLE_VERIFY',
      targetType: 'task_links',
      targetId: String(link.id),
      metadata: { authMethod: 'GOOGLE_DEVELOPMENT' },
      ip: null,
    });
    return sessionToken;
  }

  /** Starts the AraID alternative for any active teacher in the link's school. */
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
    const authorization = await this.araIdChallengeStore.claimOrRenew(ARAID_SCOPE, challengeToken);
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
    this.assertLinkRecordUsable(link);
    return link;
  }

  private assertLinkRecordUsable(
    link: Record<string, unknown> | null,
  ): asserts link is Record<string, unknown> {
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
    if (link.status === 'CANCELLED') {
      throw new GoneException('ลิงก์นี้ถูกยกเลิกแล้ว');
    }
    if (typeof link.opens_at === 'string' && new Date(link.opens_at) > new Date()) {
      throw new ForbiddenException('ลิงก์นี้ยังไม่เปิดใช้งาน');
    }
  }

  /** AraID must belong to the assigned teacher, or to any of the school's teachers when the link names none. */
  private async assertAraIdIdentityMatchesLink(
    linkId: string,
    araIdProfileId: string,
  ): Promise<void> {
    const identity = await this.taskRepository.findTaskLinkAraIdIdentity(linkId);
    const schoolId = Number(identity?.target_school_id);
    if (!Number.isInteger(schoolId) || schoolId <= 0) {
      throw new ConflictException('ลิงก์นี้ไม่มีโรงเรียนที่ใช้ตรวจสอบตัวตน');
    }
    const verified = await this.araIdService.getVerifiedIdentityNumber(araIdProfileId);
    const teacher = await this.taskRepository.findActiveTeacherInSchoolByCitizenId(
      verified.trim(),
      schoolId,
    );
    if (!teacher) {
      throw new ForbiddenException('AraID นี้ไม่ตรงกับครูที่เปิดใช้งานในโรงเรียนของลิงก์');
    }
    this.assertAssignedTeacher(identity ?? {}, teacher.teacher_id);
  }

  async getTaskByToken(token: string, sessionToken?: string) {
    const tokenHash = hashToken(token);
    const link = await this.taskRepository.findTaskLinkByTokenHash(tokenHash);
    if (!link) {
      return null;
    }

    // A withdrawn assignment closes its link exactly like expiry does: whoever
    // still holds the URL must not be able to report on work that was taken back.
    if (link.status === 'CANCELLED') {
      return { error: 'ลิงก์นี้ถูกยกเลิกการมอบหมายแล้ว', status: 'CANCELLED' };
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

    const sessionVerified = await this.magicSessionStore.isVerified(String(link.id), sessionToken);

    // Every public link proves identity before it hands anything over — one
    // rule shared with the teacher access link and the LINE verification link,
    // both of which gate unconditionally.
    //
    // Google and AraID both issue the same short-lived, link-scoped session.
    // The URL alone never reveals a minor's name, address or phone.
    const authRequired = !sessionVerified;

    const result: Record<string, unknown> = {
      task_id: link.task_id,
      link_id: link.id,
      type: link.task_type,
      task_type: link.task_type,
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
              follow_up_problem_category_label:
                typeof row.follow_up_problem_category_label === 'string'
                  ? row.follow_up_problem_category_label
                  : null,
              follow_up_problem_category_guidance:
                typeof row.follow_up_problem_category_guidance === 'string'
                  ? row.follow_up_problem_category_guidance
                  : null,
              exception_label: typeof row.exception_label === 'string' ? row.exception_label : null,
            }))
          : [];
        if (link.task_type === 'VISIT' && Number.isInteger(caseId)) {
          const prefill = await this.taskRepository.findRepeatVisitPrefill(
            caseId,
            String(link.task_id),
          );
          if (prefill) {
            result.prefill = {
              source_submission_id: Number(prefill.source_submission_id),
              source_round_number: Number(prefill.source_round_number),
              source_submitted_at: prefill.source_submitted_at ?? null,
              parental_status_code:
                typeof prefill.parental_status_code === 'string'
                  ? prefill.parental_status_code
                  : null,
              guardian_type_code:
                typeof prefill.guardian_type_code === 'string' ? prefill.guardian_type_code : null,
              guardian_type_detail:
                typeof prefill.guardian_type_detail === 'string'
                  ? prefill.guardian_type_detail
                  : null,
              contact_person_name:
                typeof prefill.contact_person_name === 'string'
                  ? prefill.contact_person_name
                  : null,
              contact_channel_code:
                typeof prefill.contact_channel_code === 'string'
                  ? prefill.contact_channel_code
                  : null,
              residence_environment_codes: Array.isArray(prefill.residence_environment_codes)
                ? prefill.residence_environment_codes.filter(
                    (code): code is string => typeof code === 'string',
                  )
                : [],
              residence_environment_detail:
                typeof prefill.residence_environment_detail === 'string'
                  ? prefill.residence_environment_detail
                  : null,
            };
          }
        }
      }
    }

    return result;
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
   * explicit shape (never the raw row) so the token hash is never leaked.
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
      const status =
        link.status === 'CANCELLED'
          ? 'CANCELLED'
          : isExpired
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
