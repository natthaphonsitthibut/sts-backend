import { createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { lineConfig, missingLineConfigKeys } from '../../config/line.config';
import type {
  MessagingAuthorizationRequest,
  MessagingAuthorizationResult,
  MessagingDeliveryResult,
  MessagingFriendState,
  MessagingOutboundMessage,
  MessagingProvider,
} from './messaging.types';

const LINE_AUTHORIZE_URL = 'https://access.line.me/oauth2/v2.1/authorize';
const LINE_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/token';
const LINE_VERIFY_ID_TOKEN_URL = 'https://api.line.me/oauth2/v2.1/verify';
const LINE_FRIENDSHIP_STATUS_URL = 'https://api.line.me/friendship/v1/status';
const LINE_BOT_PROFILE_URL = 'https://api.line.me/v2/bot/profile';
const LINE_PUSH_URL = 'https://api.line.me/v2/bot/message/push';
const LINE_ADD_FRIEND_BASE_URL = 'https://line.me/R/ti/p/';
const SEND_CONCURRENCY = 10;

/** `openid` is what makes LINE return the id_token we verify the identity from. */
const LOGIN_SCOPES = 'openid profile';

interface LineTokenResponse {
  access_token?: string;
  id_token?: string;
}

interface LineVerifiedIdToken {
  sub?: string;
  name?: string;
}

interface LineFriendshipResponse {
  friendFlag?: boolean;
}

@Injectable()
export class LineMessagingProvider implements MessagingProvider {
  private readonly logger = new Logger(LineMessagingProvider.name);

  constructor(
    @Inject(lineConfig.KEY)
    private readonly config: ConfigType<typeof lineConfig>,
  ) {
    if (this.config.enabled) {
      const missing = missingLineConfigKeys(this.config);
      if (missing.length > 0) {
        this.logger.error(
          `LINE_ENABLED=true but these are unset, so LINE stays off: ${missing.join(', ')}`,
        );
      }
    }
  }

  isEnabled(): boolean {
    return this.config.enabled && missingLineConfigKeys(this.config).length === 0;
  }

  buildAuthorizationUrl(request: MessagingAuthorizationRequest): string {
    const url = new URL(LINE_AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.loginChannelId);
    url.searchParams.set('redirect_uri', this.config.loginCallbackUrl);
    url.searchParams.set('state', request.state);
    url.searchParams.set('nonce', request.nonce);
    url.searchParams.set('scope', LOGIN_SCOPES);
    if (request.promptAddFriend) {
      // Only has an effect when the Login channel is linked to the OA in the
      // LINE console; without that link the teacher signs in without ever being
      // offered the add-friend tick.
      url.searchParams.set('bot_prompt', 'aggressive');
    }
    return url.toString();
  }

  buildAddContactUrl(): string {
    return `${LINE_ADD_FRIEND_BASE_URL}${this.config.officialAccountBasicId}`;
  }

  async completeAuthorization(
    code: string,
    expectedNonce: string,
  ): Promise<MessagingAuthorizationResult> {
    const token = await this.requestJson<LineTokenResponse>(
      LINE_TOKEN_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.config.loginCallbackUrl,
          client_id: this.config.loginChannelId,
          client_secret: this.config.loginChannelSecret,
        }).toString(),
      },
      'exchange the sign-in code',
    );
    if (!token.id_token || !token.access_token) {
      throw new ServiceUnavailableException('เชื่อมบัญชี LINE ไม่สำเร็จ กรุณาลองใหม่');
    }

    // LINE verifies the signature, audience and nonce for us. Doing it here
    // rather than decoding the JWT locally means a replayed or foreign token is
    // rejected by the issuer itself, not by our own crypto.
    const identity = await this.requestJson<LineVerifiedIdToken>(
      LINE_VERIFY_ID_TOKEN_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          id_token: token.id_token,
          client_id: this.config.loginChannelId,
          nonce: expectedNonce,
        }).toString(),
      },
      'verify the LINE identity token',
    );
    if (!identity.sub) {
      throw new ServiceUnavailableException('เชื่อมบัญชี LINE ไม่สำเร็จ กรุณาลองใหม่');
    }

    return {
      identity: { providerUserId: identity.sub, displayName: identity.name ?? null },
      friendState: await this.readFriendStateFromLogin(token.access_token),
    };
  }

  /**
   * Reading friendship with the signed-in user's own token is the only check
   * that distinguishes "never added" from "added then blocked" at sign-in time.
   */
  private async readFriendStateFromLogin(userAccessToken: string): Promise<MessagingFriendState> {
    try {
      const status = await this.requestJson<LineFriendshipResponse>(
        LINE_FRIENDSHIP_STATUS_URL,
        { headers: { authorization: `Bearer ${userAccessToken}` } },
        'read the LINE friendship status',
      );
      return status.friendFlag === true ? 'FRIEND' : 'NOT_FRIEND';
    } catch {
      // An unknown reading cannot prove reachability, so the linking service
      // asks the teacher to add the account and retry.
      return 'UNKNOWN';
    }
  }

  async readFriendState(providerUserId: string): Promise<MessagingFriendState> {
    const response = await this.send(
      `${LINE_BOT_PROFILE_URL}/${encodeURIComponent(providerUserId)}`,
      { headers: { authorization: `Bearer ${this.config.messagingChannelAccessToken}` } },
      'read the LINE profile',
    );
    if (response.ok) return 'FRIEND';
    // The bot profile endpoint answers 404 both for "never added" and for
    // "blocked us" — it cannot tell them apart, so neither can we.
    if (response.status === 404) return 'NOT_FRIEND';
    return 'UNKNOWN';
  }

  async sendMessages(
    messages: readonly MessagingOutboundMessage[],
    idempotencyKeyPrefix: string,
  ): Promise<MessagingDeliveryResult[]> {
    const results: MessagingDeliveryResult[] = [];
    for (let offset = 0; offset < messages.length; offset += SEND_CONCURRENCY) {
      const chunk = messages.slice(offset, offset + SEND_CONCURRENCY);
      results.push(
        ...(await Promise.all(chunk.map((message) => this.sendOne(message, idempotencyKeyPrefix)))),
      );
    }
    return results;
  }

  private async sendOne(
    message: MessagingOutboundMessage,
    idempotencyKeyPrefix: string,
  ): Promise<MessagingDeliveryResult> {
    try {
      const response = await this.send(
        LINE_PUSH_URL,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.config.messagingChannelAccessToken}`,
            'content-type': 'application/json',
            // Same key for the same recipient in the same batch, so a retry
            // after a network wobble does not send the link twice.
            'X-Line-Retry-Key': retryKey(idempotencyKeyPrefix, message.providerUserId),
          },
          body: JSON.stringify({
            to: message.providerUserId,
            messages: [{ type: 'text', text: message.text }],
          }),
        },
        'send the LINE message',
      );
      if (response.ok) {
        return { providerUserId: message.providerUserId, delivered: true };
      }
      return {
        providerUserId: message.providerUserId,
        delivered: false,
        errorMessage: describeFailure(response),
      };
    } catch (error) {
      return {
        providerUserId: message.providerUserId,
        delivered: false,
        errorMessage: error instanceof Error ? error.message : 'ส่งข้อความไม่สำเร็จ',
      };
    }
  }

  verifyWebhookSignature(rawBody: Buffer | string, signature: string): boolean {
    if (!signature) return false;
    const expected = createHmac('sha256', this.config.messagingChannelSecret)
      .update(rawBody)
      .digest();
    let received: Buffer;
    try {
      received = Buffer.from(signature, 'base64');
    } catch {
      return false;
    }
    if (received.length !== expected.length) return false;
    return timingSafeEqual(received, expected);
  }

  private async send(url: string, init: RequestInit, action: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } catch (error) {
      this.logger.error(
        `LINE request failed (${action}): ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException('ติดต่อระบบ LINE ไม่ได้ กรุณาลองใหม่');
    } finally {
      clearTimeout(timeout);
    }
  }

  private async requestJson<T>(url: string, init: RequestInit, action: string): Promise<T> {
    const response = await this.send(url, init, action);
    if (!response.ok) {
      this.logger.error(`LINE rejected the request to ${action}: HTTP ${response.status}`);
      throw new ServiceUnavailableException('ติดต่อระบบ LINE ไม่ได้ กรุณาลองใหม่');
    }
    try {
      return (await response.json()) as T;
    } catch {
      throw new ServiceUnavailableException('ติดต่อระบบ LINE ไม่ได้ กรุณาลองใหม่');
    }
  }
}

/** LINE caps the retry key at a UUID-shaped string, so the pair is hashed into one. */
function retryKey(prefix: string, providerUserId: string): string {
  const digest = createHmac('sha256', prefix).update(providerUserId).digest('hex');
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    digest.slice(12, 16),
    digest.slice(16, 20),
    digest.slice(20, 32),
  ].join('-');
}

function describeFailure(response: Response): string {
  // 400 here is nearly always "the recipient is not reachable" (blocked or
  // removed the account) rather than a malformed request, since the body is
  // built server-side.
  if (response.status === 400 || response.status === 404) {
    return 'ผู้รับไม่ได้เป็นเพื่อนกับบัญชีทางการ หรือบล็อกไว้';
  }
  if (response.status === 429) return 'ส่งข้อความเกินโควตาของบัญชีทางการ';
  return `ส่งข้อความไม่สำเร็จ (HTTP ${response.status})`;
}
