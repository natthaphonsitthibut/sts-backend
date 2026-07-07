import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { hashToken, generateToken, clean } from '../common/utils/helpers';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NotificationsService } from '../notifications/notifications.service';
import { DelegateTaskDto } from './dto/task.dto';
import { TaskAccessService } from './task-access.service';
import { TaskRepository } from './task.repository';
import type { QueryResultRow } from './task.types';

const MAX_EXPIRY_HOURS = 2160;
const DEFAULT_EXPIRY_HOURS = 24;

@Injectable()
export class DelegationService {
  private readonly logger = new Logger(DelegationService.name);

  constructor(
    private readonly taskRepository: TaskRepository,
    private readonly taskAccessService: TaskAccessService,
    private readonly auditLog: AuditLogService,
    private readonly notificationsService: NotificationsService,
  ) {}

  private normalizeNumber(value: string | number | null | undefined): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
  }

  private validateDelegationAccess(
    task: Awaited<ReturnType<TaskAccessService['getTaskByToken']>>,
  ): void {
    if (!task) {
      throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ไม่ถูกต้อง');
    }

    if ('error' in task && task.error) {
      const status = typeof task.status === 'string' ? task.status : '';
      const message = typeof task.error === 'string' ? task.error : 'ลิงก์ใช้งานไม่ได้';
      if (status === 'EXPIRED') {
        throw new GoneException(message);
      }
      if (status === 'ADMIN_LOCKED') {
        throw new ForbiddenException(message);
      }
      if (status === 'COMPLETED' || status === 'DELEGATED') {
        throw new ConflictException(message);
      }
      throw new BadRequestException(message);
    }

    if (task.auth_required === true) {
      throw new ForbiddenException('กรุณายืนยัน OTP ก่อนส่งต่อภารกิจ');
    }
    if (task.can_delegate !== true) {
      throw new ConflictException('ลิงก์นี้ไม่สามารถส่งต่อได้');
    }
  }

  private validateLockedLink(link: QueryResultRow | null): QueryResultRow {
    if (!link) {
      throw new NotFoundException('ไม่พบลิงก์หรือลิงก์ถูกลบแล้ว');
    }
    if (new Date(String(link.expires_at)) < new Date()) {
      throw new GoneException('Link expired');
    }
    if (link.admin_locked) {
      throw new ForbiddenException('Link is disabled by admin');
    }
    if (link.status !== 'ACTIVE') {
      throw new ConflictException('Link is no longer active');
    }
    if (Number(link.delegation_depth) >= Number(link.max_delegation_depth)) {
      throw new ForbiddenException('Max delegation depth reached');
    }
    return link;
  }

  async delegateTask(token: string, data: DelegateTaskDto, baseUrl: string, sessionToken?: string) {
    const accessTask = await this.taskAccessService.getTaskByToken(token, sessionToken);
    this.validateDelegationAccess(accessTask);

    const tokenHash = hashToken(token);
    const newAssigneeName = clean(data.new_assignee_name);
    const newAssigneePhone = clean(data.new_assignee_phone);
    const newAssigneeEmail = clean(data.new_assignee_email);
    const delegateHours = Math.min(
      this.normalizeNumber(data.expires_in_hours) || DEFAULT_EXPIRY_HOURS,
      MAX_EXPIRY_HOURS,
    );

    if (!newAssigneeName) {
      throw new Error('new_assignee_name is required');
    }

    const link = await this.taskRepository.findDelegationLinkByTokenHash(tokenHash);
    if (!link) {
      throw new NotFoundException('Link not found');
    }

    const newToken = generateToken();
    const newTokenHash = hashToken(newToken);
    const newLinkId = crypto.randomUUID();
    // Email-assigned links require OTP (start unverified); links with no email
    // can't be OTP'd, so mark them pre-verified to skip the gate.
    const otpVerified = newAssigneeEmail ? 0 : 1;
    const expiresAt = new Date(Date.now() + delegateHours * 60 * 60 * 1000).toISOString();
    const magicLink = `${baseUrl}/task/${newToken}`;

    const delegation = await this.taskRepository.withTransaction(async (executor) => {
      const lockedLink = this.validateLockedLink(
        await this.taskRepository.lockDelegationLinkForUpdate(String(link.id), executor),
      );
      const nextDepth = Number(lockedLink.delegation_depth) + 1;
      const transitioned = await this.taskRepository.transitionTaskLinkStatus(
        String(lockedLink.id),
        'ACTIVE',
        'DELEGATED',
        executor,
      );
      if (!transitioned) {
        throw new ConflictException('Link is no longer active');
      }

      await this.taskRepository.createDelegatedTaskLink(
        {
          linkId: newLinkId,
          taskId: String(lockedLink.task_id),
          parentLinkId: String(lockedLink.id),
          tokenHash: newTokenHash,
          magicLink,
          delegationDepth: nextDepth,
          assignedToName: newAssigneeName,
          assignedToPhone: newAssigneePhone,
          assignedToEmail: newAssigneeEmail,
          expiresAt,
          subject: null,
          subjectId: null,
          otpVerified,
          createdBy: null,
          loginRole: null,
          loginPermissions: [],
          loginDataScope: {},
        },
        executor,
      );

      return {
        actorLabel: clean(lockedLink.assigned_to_name) || 'guest',
        parentLinkId: String(lockedLink.id),
        nextDepth,
      };
    });
    await this.auditLog.record({
      actorUserId: null,
      actorLabel: delegation.actorLabel,
      action: 'DELEGATION',
      targetType: 'task_link',
      targetId: newLinkId,
      metadata: { parentLinkId: delegation.parentLinkId, toDepth: delegation.nextDepth },
      ip: null,
    });
    this.logger.log(`Delegation completed at depth ${delegation.nextDepth}`);
    await this.notificationsService.notifyTaskDelegated({
      taskId: String(link.task_id),
      assigneeName: newAssigneeName,
    });

    let qrDataUrl: string | null = null;
    try {
      qrDataUrl = await QRCode.toDataURL(magicLink, { width: 300, margin: 2 });
    } catch {
      this.logger.warn('Failed to generate delegation QR code');
    }

    return {
      magic_link: magicLink,
      qr_code_data: qrDataUrl,
      expires_at: expiresAt,
      delegation_depth: delegation.nextDepth,
    };
  }
}
