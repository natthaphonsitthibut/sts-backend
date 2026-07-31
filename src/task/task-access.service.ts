import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as crypto from 'crypto';
import { authConfig } from '../config/auth.config';
import { emailConfig } from '../config/email.config';
import { clean, hashToken } from '../common/utils/helpers';
import { resolveAuditActorId } from '../common/audit/audit-actor.util';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EmailService } from './email.service';
import { TaskPolicyService } from './task-policy.service';
import {
  TaskRepository,
  type LoginLinkListFilters,
  type VisitLinkListFilters,
} from './task.repository';
import { getTaskErrorMessage, type ActorContext } from './task.types';
import {
  buildPaginationMeta,
  resolveLimit,
  resolvePage,
} from '../common/pagination/pagination.util';
import { MagicSessionStoreService } from '../auth/magic-session-store.service';

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
    @Inject(emailConfig.KEY)
    private readonly emailRuntimeConfig: ConfigType<typeof emailConfig>,
    private readonly magicSessionStore: MagicSessionStoreService,
  ) {}

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

    if (
      link.status === 'COMPLETED' &&
      link.task_type !== 'ATTENDANCE' &&
      link.task_type !== 'LOGIN'
    ) {
      return { error: 'Task already completed', status: 'COMPLETED' };
    }

    if (link.status === 'DELEGATED') {
      return { error: 'Task already delegated', status: 'DELEGATED' };
    }

    const canDelegate =
      Number(link.delegation_depth) < Number(link.max_delegation_depth) &&
      link.status === 'ACTIVE' &&
      !link.admin_locked;
    const hasEmailForOtp =
      typeof link.assigned_to_email === 'string' && link.assigned_to_email.trim().length > 0;
    const sessionVerified = !link.otp_verified
      ? await this.magicSessionStore.isVerified(String(link.id), sessionToken)
      : false;

    // OTP is gated on email actually being deliverable — both the transport
    // enabled AND a sender configured. Otherwise the OTP would only be logged
    // (simulated) and the guest could never receive it, so fall back to no-OTP
    // single-factor links instead of locking them out. (no hardcoded flag)
    const otpEnabled =
      this.emailRuntimeConfig.enabled && this.emailRuntimeConfig.user.trim().length > 0;
    const authRequired = otpEnabled && hasEmailForOtp && !link.otp_verified && !sessionVerified;

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
      assigned_to_name: link.assigned_to_name,
      assigned_to_first_name: link.assigned_to_first_name ?? null,
      assigned_to_last_name: link.assigned_to_last_name ?? null,
      delegation_depth: link.delegation_depth,
      max_delegation_depth: link.max_delegation_depth,
      can_delegate: canDelegate,
      status: link.status,
      opens_at: link.opens_at ?? null,
      expires_at: link.expires_at,
      delegation_note: link.delegation_note ?? null,
      created_at: link.created_at ?? null,
      subject: link.subject,
      school_name: link.school_name,
      auth_required: authRequired,
      login_role: link.login_role || null,
      login_permissions: link.login_permissions || [],
      login_data_scope: link.login_data_scope || {},
    };

    if (link.task_type === 'VISIT') {
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
              cause_detail: typeof row.cause_detail === 'string' ? row.cause_detail : null,
              exception_label: typeof row.exception_label === 'string' ? row.exception_label : null,
            }))
          : [];
      }
    }

    if (link.task_type === 'ATTENDANCE') {
      const slots = await this.taskRepository.listLinkedTimetableSlots(String(link.id));
      result.timetable_slots = slots.map((slot) => ({
        id: Number(slot.id),
        day_of_week: Number(slot.day_of_week),
        period: Number(slot.period),
        subject_id: Number(slot.subject_id),
        subject_name_th: typeof slot.subject_name_th === 'string' ? slot.subject_name_th : null,
        teacher_name: typeof slot.teacher_name === 'string' ? slot.teacher_name : null,
      }));
    }

    return result;
  }

  async verifyMagicLogin(token: string, sessionToken?: string) {
    try {
      const link = await this.getTaskByToken(token, sessionToken);
      if (!link) {
        throw new Error('ไม่พบข้อมูลลิงก์หรือลิงก์ไม่ถูกต้อง');
      }
      if ('error' in link && link.error) {
        throw new Error(getTaskErrorMessage(link.error));
      }
      if (link.task_type !== 'LOGIN') {
        throw new Error('ลิงก์นี้ไม่ใช่ลิงก์เข้าสู่ระบบ');
      }

      if (link.auth_required) {
        return {
          otp_required: true,
          email: link.assigned_to_email,
          expires_at: link.expires_at,
          assigned_to_name: link.assigned_to_name,
        };
      }

      const email = typeof link.assigned_to_email === 'string' ? link.assigned_to_email : '';
      if (!email) {
        throw new Error('ลิงก์นี้ไม่มีข้อมูลอีเมลผู้ใช้งานที่เชื่อมโยง');
      }

      const roleMap = await this.taskPolicyService.getRoleMap();
      const resolvedRole =
        typeof link.login_role === 'string' && link.login_role.trim().length > 0
          ? link.login_role.trim()
          : 'TEACHER';
      const resolvedPermissions = this.taskPolicyService.resolveEffectivePermissions(
        resolvedRole,
        link.login_permissions,
        roleMap,
      );
      const resolvedScope = this.taskPolicyService.normalizeScope(link.login_data_scope);
      await this.taskRepository.markLoginLinkUsed(String(link.link_id));

      return {
        id: this.buildVirtualUserId(String(link.link_id)),
        username: email,
        FirstName: link.assigned_to_name || 'ผู้ใช้ผ่านลิงก์',
        LastName: null,
        email,
        affiliation: 'External Link',
        status: 'ACTIVE',
        role: resolvedRole,
        permissions: resolvedPermissions,
        roles: [resolvedRole],
        labels: [this.taskPolicyService.getRoleLabel(resolvedRole, roleMap) || resolvedRole],
        data_scope: resolvedScope,
        virtual_login: true,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`verifyMagicLogin error: ${message}`);
      throw err;
    }
  }

  async getLoginLinks(actor?: ActorContext, filters: Partial<LoginLinkListFilters> = {}) {
    try {
      const currentActor = this.taskPolicyService.ensureActor(actor);
      const roleMap = await this.taskPolicyService.getRoleMap();
      const actorRole = this.taskPolicyService.getPrimaryRole({ roles: currentActor.roles });
      const actorRank = this.taskPolicyService.getRoleRank(actorRole, roleMap);
      const page = resolvePage(filters.page);
      const limit = resolveLimit(filters.limit);
      const { rows, totalCount, summary } = await this.taskRepository.listLoginLinksPaginated({
        actorRole,
        actorRank,
        actorScope: currentActor.data_scope,
        status: filters.status,
        searchTerm: filters.searchTerm,
        province: filters.province,
        district: filters.district,
        subDistrict: filters.subDistrict,
        schoolId: filters.schoolId,
        gradeLevelId: filters.gradeLevelId,
        room: filters.room,
        page,
        limit,
      });

      return {
        success: true,
        data: rows,
        meta: buildPaginationMeta(page, limit, totalCount),
        summary,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getLoginLinks error: ${message}`);
      throw err;
    }
  }

  async getVisitLinks(actor?: ActorContext, filters: Partial<VisitLinkListFilters> = {}) {
    try {
      const currentActor = this.taskPolicyService.ensureActor(actor);
      const page = resolvePage(filters.page);
      const limit = resolveLimit(filters.limit);
      const { rows, totalCount, summary } = await this.taskRepository.listVisitLinksPaginated(
        currentActor,
        {
          status: filters.status,
          searchTerm: filters.searchTerm,
          province: filters.province,
          district: filters.district,
          subDistrict: filters.subDistrict,
          schoolId: filters.schoolId,
          gradeLevelId: filters.gradeLevelId,
          room: filters.room,
          page,
          limit,
        },
      );

      return {
        success: true,
        data: rows,
        meta: buildPaginationMeta(page, limit, totalCount),
        summary,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getVisitLinks error: ${message}`);
      throw err;
    }
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
      if (
        link.task_type !== 'LOGIN' &&
        link.task_type !== 'ATTENDANCE' &&
        link.task_type !== 'VISIT'
      ) {
        throw new Error('Only LOGIN, ATTENDANCE, and VISIT links can be changed by admin');
      }
      if (link.status !== 'ACTIVE') {
        throw new Error('Only ACTIVE links can be changed by admin');
      }

      const roleMap = await this.taskPolicyService.getRoleMap();
      if (
        !this.taskPolicyService.canManageAdminLink(
          currentActor,
          {
            task_type: typeof link.task_type === 'string' ? link.task_type : null,
            login_role: typeof link.login_role === 'string' ? link.login_role : null,
            login_data_scope: link.login_data_scope,
            target_school_id: link.target_school_id,
            target_room: link.target_room,
            case_created_by: link.case_created_by,
          },
          roleMap,
        )
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
            scope: link.task_type === 'LOGIN' ? link.login_data_scope : undefined,
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
          scope: link.task_type === 'LOGIN' ? link.login_data_scope : undefined,
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
  async getAdminLinkDetail(actor: ActorContext | undefined, linkId: string, date?: string) {
    try {
      const currentActor = this.taskPolicyService.ensureActor(actor);
      const link = await this.taskRepository.findLinkDetailById(linkId);

      if (!link) {
        throw new NotFoundException('ไม่พบลิงก์');
      }

      const roleMap = await this.taskPolicyService.getRoleMap();
      if (
        !this.taskPolicyService.canManageAdminLink(
          currentActor,
          {
            task_type: typeof link.task_type === 'string' ? link.task_type : null,
            login_role: typeof link.login_role === 'string' ? link.login_role : null,
            login_data_scope: link.login_data_scope,
            target_school_id: link.target_school_id,
            target_room: link.target_room,
            case_created_by: link.case_created_by,
          },
          roleMap,
        )
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

      const schoolId =
        typeof link.target_school_id === 'number'
          ? link.target_school_id
          : typeof link.target_school_id === 'string' && link.target_school_id.trim().length > 0
            ? Number.parseInt(link.target_school_id, 10)
            : null;

      const records =
        link.task_type === 'ATTENDANCE' && typeof date === 'string' && date.trim().length > 0
          ? await this.taskRepository.listTaskHistory(
              date,
              typeof link.target_grade === 'string' ? link.target_grade : null,
              typeof link.target_room === 'string' ? link.target_room : null,
              Number.isInteger(schoolId) ? schoolId : null,
              typeof link.id === 'string' ? link.id : null,
            )
          : [];

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
        records,
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
