import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as crypto from 'crypto';
import { authConfig } from '../config/auth.config';
import { RedisClientService } from '../redis/redis-client.service';

/**
 * Who the session was issued to, for a flow that has to record it — the
 * agency's referral link keeps the reporter's verified identity here until the
 * report is filed. Never holds a citizen id.
 */
export type MagicSessionClaims = Record<string, string>;

interface LegacyMagicSessionPayload {
  link_id?: string;
  verified?: boolean;
  ts?: number;
  claims?: MagicSessionClaims;
}

interface StoredMagicSession {
  linkId: string;
  issuedAt: number;
  claims?: MagicSessionClaims;
}

@Injectable()
export class MagicSessionStoreService {
  constructor(
    private readonly redisClientService: RedisClientService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async issue(linkId: string, claims?: MagicSessionClaims): Promise<string> {
    const client = this.redisClientService.getClient();
    if (!client) {
      return this.issueLegacySignedToken(linkId, claims);
    }

    const token = `ms_${crypto.randomBytes(32).toString('base64url')}`;
    const payload: StoredMagicSession = {
      linkId,
      issuedAt: Date.now(),
      ...(claims ? { claims } : {}),
    };
    await client.set(
      this.redisKey(token),
      JSON.stringify(payload),
      'EX',
      this.config.magicSessionTtlSeconds,
    );
    return token;
  }

  async isVerified(linkId: string, sessionToken?: string): Promise<boolean> {
    return (await this.readVerifiedClaims(linkId, sessionToken)) !== null;
  }

  /**
   * The claims of a fresh session issued for `linkId`, `{}` when it carries
   * none, or `null` when the session is missing, stale or for another link.
   */
  async readVerifiedClaims(
    linkId: string,
    sessionToken?: string,
  ): Promise<MagicSessionClaims | null> {
    if (!sessionToken) {
      return null;
    }

    const client = this.redisClientService.getClient();
    if (!client) {
      return this.readLegacySignedTokenClaims(linkId, sessionToken);
    }

    try {
      const stored = await client.get(this.redisKey(sessionToken));
      if (!stored) {
        return null;
      }

      const data = JSON.parse(stored) as StoredMagicSession;
      return data.linkId === linkId && this.isFreshIssuedAt(data.issuedAt)
        ? (data.claims ?? {})
        : null;
    } catch {
      return null;
    }
  }

  private issueLegacySignedToken(linkId: string, claims?: MagicSessionClaims): string {
    const payload = JSON.stringify({
      link_id: linkId,
      verified: true,
      ts: Date.now(),
      ...(claims ? { claims } : {}),
    });
    const signature = crypto
      .createHmac('sha256', this.config.sessionSecret)
      .update(payload)
      .digest('hex');
    return `${Buffer.from(payload).toString('base64')}.${signature}`;
  }

  private readLegacySignedTokenClaims(
    linkId: string,
    sessionToken: string,
  ): MagicSessionClaims | null {
    try {
      const [base64Payload, signature] = sessionToken.split('.');
      const payload = Buffer.from(base64Payload, 'base64').toString('utf-8');
      const expectedSignature = crypto
        .createHmac('sha256', this.config.sessionSecret)
        .update(payload)
        .digest('hex');

      const expectedBuf = Buffer.from(expectedSignature);
      const providedBuf = Buffer.from(signature ?? '');
      if (
        expectedBuf.length !== providedBuf.length ||
        !crypto.timingSafeEqual(expectedBuf, providedBuf)
      ) {
        return null;
      }

      const data = JSON.parse(payload) as LegacyMagicSessionPayload;
      return data.link_id === linkId && data.verified === true && this.isFreshIssuedAt(data.ts)
        ? (data.claims ?? {})
        : null;
    } catch {
      return null;
    }
  }

  private isFreshIssuedAt(issuedAt: unknown): boolean {
    const timestamp = typeof issuedAt === 'number' ? issuedAt : 0;
    const ageMs = Date.now() - timestamp;
    const ttlMs = this.config.magicSessionTtlSeconds * 1000;
    return Number.isFinite(timestamp) && timestamp > 0 && ageMs <= ttlMs && ageMs >= 0;
  }

  private redisKey(token: string): string {
    return `sts:magic-session:${crypto.createHash('sha256').update(token).digest('hex')}`;
  }
}
