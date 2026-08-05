import { randomInt, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { AuditLogService } from '../audit-log/audit-log.service';
import { EmailService } from '../common/email/email.service';
import { MESSAGING_PROVIDER, type MessagingProvider } from '../common/messaging/messaging.types';
import { OtpStore } from '../common/otp/otp.store';
import { appConfig } from '../config/app.config';
import { authConfig } from '../config/auth.config';
import { lineConfig } from '../config/line.config';
import { TeacherLineRepository } from './teacher-line.repository';
import { TeacherLineSessionStore } from './teacher-line-session.store';
import type { TeacherLineLinkOutcome } from './teacher-line.types';

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

@Injectable()
export class TeacherLineService {
  private readonly logger = new Logger(TeacherLineService.name);

  constructor(
    private readonly repository: TeacherLineRepository,
    private readonly sessionStore: TeacherLineSessionStore,
    private readonly otpStore: OtpStore,
    private readonly emailService: EmailService,
    private readonly auditLog: AuditLogService,
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

  /**
   * Step 1. Emails a code to the address the teacher typed. The response never
   * varies, so a caller learns nothing from it.
   */
  async requestOtp(email: string, ip: string | null): Promise<{ message: string }> {
    this.assertEnabled();
    const teacher = await this.repository.findActiveTeacherByEmail(email);
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
    } catch (error) {
      // Keep the public response indistinguishable from an unknown address.
      // Operational failures remain visible in server logs without exposing
      // the address or proving that a teacher account exists.
      this.logger.error(
        `LINE link OTP delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
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
  ): Promise<{ bindingToken: string; teacherName: string }> {
    this.assertEnabled();
    const teacher = await this.repository.findActiveTeacherByEmail(email);
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
      } catch (error) {
        this.logger.error(
          `LINE link OTP failure audit failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      throw new BadRequestException(GENERIC_OTP_VERIFY_MESSAGE);
    }

    return {
      bindingToken: await this.sessionStore.createBindingSession({
        teacherId: teacher.teacher_id,
        email: teacher.email,
      }),
      teacherName: `${teacher.first_name} ${teacher.last_name}`.trim(),
    };
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
    } catch (error) {
      this.logger.error(
        `LINE link callback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { outcome: 'FAILED', addContactUrl: null };
    }

    if (friendState !== 'FRIEND') {
      // Not recorded as verified: a binding that cannot be messaged is worse
      // than none, because the teacher table would claim they are reachable.
      return { outcome: 'NOT_FRIEND', addContactUrl: this.messaging.buildAddContactUrl() };
    }

    const channelId = this.line.messagingChannelId;
    const outcome = await this.repository.withTransaction(async (queryRunner) => {
      const heldByOther = await this.repository.findActiveAccountByProviderUser(
        channelId,
        identity.providerUserId,
        queryRunner,
      );
      let linkOutcome: 'SUCCESS' | 'ALREADY_LINKED_TO_ANOTHER_TEACHER';
      if (heldByOther && heldByOther.teacher_id !== session.teacherId) {
        linkOutcome = 'ALREADY_LINKED_TO_ANOTHER_TEACHER';
      } else {
        const current = await this.repository.findActiveAccountForTeacher(
          session.teacherId,
          channelId,
          queryRunner,
        );
        if (current && current.provider_user_id === identity.providerUserId) {
          // Re-verifying the same account: refresh what we know, keep the row.
          await this.repository.updateFriendState(
            current.id,
            friendState,
            identity.displayName,
            queryRunner,
          );
        } else {
          if (current) {
            // Replaced, not overwritten — the old binding stays readable so
            // previous recipients remain auditable.
            await this.repository.unlinkAccount(
              current.id,
              'REPLACED_BY_NEW_VERIFICATION',
              queryRunner,
            );
          }
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
        }
        linkOutcome = 'SUCCESS';
      }

      // Binding and its audit record commit or roll back together. Otherwise an
      // audit outage could leave an unaudited recipient while the browser sees
      // a failed callback and retries the operation.
      await this.auditLog.recordAtomic(
        {
          actorUserId: null,
          actorLabel: 'line-link',
          action:
            linkOutcome === 'SUCCESS' ? 'TEACHER_MESSAGING_LINK' : 'TEACHER_MESSAGING_LINK_DENIED',
          targetType: 'teachers',
          targetId: session.teacherId,
          metadata: { provider: 'LINE', outcome: linkOutcome },
          ip,
        },
        queryRunner,
      );
      return linkOutcome;
    });

    if (outcome === 'SUCCESS') {
      await this.sessionStore.clearBindingSession(pending.bindingToken);
    }
    return {
      outcome,
      addContactUrl: outcome === 'SUCCESS' ? null : this.messaging.buildAddContactUrl(),
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

  /** Where the browser lands after the callback, with only non-secret hints. */
  buildResultUrl(outcome: TeacherLineLinkOutcome, addContactUrl: string | null): string {
    const url = new URL('/line-link/result', this.app.frontendBaseUrl || 'http://localhost:5173');
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
