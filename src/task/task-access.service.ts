import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { clean, hashToken } from '../common/utils/helpers';
import { EmailService } from './email.service';
import { TaskPolicyService } from './task-policy.service';
import { TaskRepository } from './task.repository';
import { getTaskErrorMessage, type ActorContext } from './task.types';

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
  private readonly magicSessionSecret = 'SECRET_STS_KEY';

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskPolicyService: TaskPolicyService,
    private readonly emailService: EmailService,
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
      ? this.isMagicSessionVerified(String(link.id), sessionToken)
      : false;

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
      delegation_depth: link.delegation_depth,
      max_delegation_depth: link.max_delegation_depth,
      can_delegate: canDelegate,
      expires_at: link.expires_at,
      subject: link.subject,
      school_name: link.school_name,
      auth_required: !!(hasEmailForOtp && !link.otp_verified && !sessionVerified),
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
        result.reason_flagged = '*** (กรุณายืนยันตัวตน) ***';
        result.student_lat = null;
        result.student_lng = null;
      } else {
        result.student_name = caseData?.student_name || null;
        result.student_school = caseData?.student_school || null;
        result.student_address = caseData?.student_address || null;
        result.student_lat = caseData?.student_lat || null;
        result.student_lng = caseData?.student_lng || null;
        result.reason_flagged = caseData?.reason_flagged || null;
      }
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

  async getLoginLinks(actor?: ActorContext) {
    try {
      const rows = await this.taskRepository.listLoginLinks();
      if (!actor) {
        return rows;
      }

      const roleMap = await this.taskPolicyService.getRoleMap();
      return rows.filter((link) =>
        this.taskPolicyService.canManageLoginLink(
          actor,
          {
            login_role: typeof link.login_role === 'string' ? link.login_role : null,
            login_data_scope: link.login_data_scope,
          },
          roleMap,
        ),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`getLoginLinks error: ${message}`);
      throw err;
    }
  }

  async requestOtp(token: string) {
    const tokenHash = hashToken(token);
    const link = await this.taskRepository.findOtpLinkByTokenHash(tokenHash);

    if (!link) {
      throw new NotFoundException('Link not found');
    }

    const email = typeof link.assigned_to_email === 'string' ? link.assigned_to_email.trim() : '';
    if (!email) {
      throw new BadRequestException('No email found for this link');
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this.taskRepository.updateLinkOtp({
      linkId: String(link.id),
      otpCode: otp,
      otpExpiresAt: expiresAt.toISOString(),
    });

    try {
      await this.emailService.sendOTP(email, otp);
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
    if (!otp) {
      throw new Error('OTP is required');
    }

    const tokenHash = hashToken(token);
    const link = await this.taskRepository.findOtpLinkByTokenHash(tokenHash);
    if (!link) {
      throw new Error('Link not found');
    }

    if (link.otp_code !== otp) {
      throw new Error('Invalid OTP code');
    }

    if (new Date(String(link.otp_expires_at)) < new Date()) {
      throw new Error('OTP expired');
    }

    const payload = JSON.stringify({
      link_id: link.id,
      verified: true,
      ts: Date.now(),
    });
    const sign = crypto.createHmac('sha256', this.magicSessionSecret).update(payload).digest('hex');
    const sessionToken = `${Buffer.from(payload).toString('base64')}.${sign}`;

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

  private isMagicSessionVerified(linkId: string, sessionToken?: string): boolean {
    if (!sessionToken) {
      return false;
    }

    try {
      const [base64Payload, signature] = sessionToken.split('.');
      const payload = Buffer.from(base64Payload, 'base64').toString('utf-8');
      const expectedSignature = crypto
        .createHmac('sha256', this.magicSessionSecret)
        .update(payload)
        .digest('hex');

      if (expectedSignature !== signature) {
        return false;
      }

      const data = JSON.parse(payload) as {
        link_id?: string;
        verified?: boolean;
      };
      return data.link_id === linkId && data.verified === true;
    } catch {
      return false;
    }
  }

  private buildVirtualUserId(linkId: string): number {
    const parsed = Number.parseInt(hashToken(linkId).slice(0, 8), 16);
    return Number.isFinite(parsed) && parsed > 0 ? -parsed : -1;
  }
}
