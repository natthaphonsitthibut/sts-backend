import { Injectable, Logger } from '@nestjs/common';
import { hashToken, generateToken, clean } from '../common/utils/helpers';
import * as QRCode from 'qrcode';
import * as crypto from 'crypto';
import { DelegateTaskDto } from './dto/task.dto';
import { TaskRepository } from './task.repository';

const MAX_EXPIRY_HOURS = 2160;
const DEFAULT_EXPIRY_HOURS = 24;

@Injectable()
export class DelegationService {
  private readonly logger = new Logger(DelegationService.name);

  constructor(private readonly taskRepository: TaskRepository) {}

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

  async delegateTask(token: string, data: DelegateTaskDto, baseUrl: string) {
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
      throw new Error('Link not found');
    }

    if (new Date(String(link.expires_at)) < new Date()) {
      throw new Error('Link expired');
    }

    if (link.status !== 'ACTIVE') {
      throw new Error('Link is no longer active');
    }

    if (link.admin_locked) {
      throw new Error('Link is disabled by admin');
    }

    if (Number(link.delegation_depth) >= Number(link.max_delegation_depth)) {
      throw new Error('Max delegation depth reached');
    }

    const newToken = generateToken();
    const newTokenHash = hashToken(newToken);
    const newLinkId = crypto.randomUUID();
    // Email-assigned links require OTP (start unverified); links with no email
    // can't be OTP'd, so mark them pre-verified to skip the gate.
    const otpVerified = newAssigneeEmail ? 0 : 1;
    const expiresAt = new Date(Date.now() + delegateHours * 60 * 60 * 1000).toISOString();
    const magicLink = `${baseUrl}/task/${newToken}`;

    await this.taskRepository.withTransaction(async (executor) => {
      await this.taskRepository.updateTaskLinkStatus(String(link.id), 'DELEGATED', executor);

      await this.taskRepository.createDelegatedTaskLink(
        {
          linkId: newLinkId,
          taskId: String(link.task_id),
          parentLinkId: String(link.id),
          tokenHash: newTokenHash,
          magicLink,
          delegationDepth: Number(link.delegation_depth) + 1,
          assignedToName: newAssigneeName,
          assignedToPhone: newAssigneePhone,
          assignedToEmail: newAssigneeEmail,
          expiresAt,
          subject: null,
          otpVerified,
          createdBy: null,
          loginRole: null,
          loginPermissions: [],
          loginDataScope: {},
        },
        executor,
      );
    });

    let qrDataUrl: string | null = null;
    try {
      qrDataUrl = await QRCode.toDataURL(magicLink, { width: 300, margin: 2 });
    } catch (err) {
      this.logger.warn('Failed to generate QR code', err);
    }

    return {
      magic_link: magicLink,
      qr_code_data: qrDataUrl,
      expires_at: expiresAt,
      delegation_depth: Number(link.delegation_depth) + 1,
    };
  }
}
