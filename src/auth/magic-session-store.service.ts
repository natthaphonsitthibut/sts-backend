import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import * as crypto from 'crypto';
import { authConfig } from '../config/auth.config';
import { RedisClientService } from '../redis/redis-client.service';

interface LegacyMagicSessionPayload {
  link_id?: string;
  verified?: boolean;
  ts?: number;
}

interface StoredMagicSession {
  linkId: string;
  issuedAt: number;
}

@Injectable()
export class MagicSessionStoreService {
  constructor(
    private readonly redisClientService: RedisClientService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async issue(linkId: string): Promise<string> {
    const client = this.redisClientService.getClient();
    if (!client) {
      return this.issueLegacySignedToken(linkId);
    }

    const token = `ms_${crypto.randomBytes(32).toString('base64url')}`;
    const payload: StoredMagicSession = {
      linkId,
      issuedAt: Date.now(),
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
    if (!sessionToken) {
      return false;
    }

    const client = this.redisClientService.getClient();
    if (!client) {
      return this.isLegacySignedTokenVerified(linkId, sessionToken);
    }

    try {
      const stored = await client.get(this.redisKey(sessionToken));
      if (!stored) {
        return false;
      }

      const data = JSON.parse(stored) as StoredMagicSession;
      return data.linkId === linkId && this.isFreshIssuedAt(data.issuedAt);
    } catch {
      return false;
    }
  }

  private issueLegacySignedToken(linkId: string): string {
    const payload = JSON.stringify({
      link_id: linkId,
      verified: true,
      ts: Date.now(),
    });
    const signature = crypto
      .createHmac('sha256', this.config.sessionSecret)
      .update(payload)
      .digest('hex');
    return `${Buffer.from(payload).toString('base64')}.${signature}`;
  }

  private isLegacySignedTokenVerified(linkId: string, sessionToken: string): boolean {
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
        return false;
      }

      const data = JSON.parse(payload) as LegacyMagicSessionPayload;
      return data.link_id === linkId && data.verified === true && this.isFreshIssuedAt(data.ts);
    } catch {
      return false;
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
