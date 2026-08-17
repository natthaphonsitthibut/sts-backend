import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisClientService } from '../redis/redis-client.service';

/**
 * One AraID QR-approval mechanism for every flow that needs it.
 *
 * The teacher-access grant, the LINE invitation and the follow-up/assistance
 * task link all approve the same way — issue a short-lived challenge, let the
 * AraID app claim it, require a fresh PIN, then approve and hand back a session.
 * Only the subject being approved differs, so it is a `scope` + `subjectId`
 * here rather than a copy of this file per flow.
 *
 * `scope` is part of the Redis key, so a challenge minted for one flow can never
 * be redeemed by another, and the existing per-flow keys stay byte-identical.
 */
export type AraIdChallengeScope = 'teacher-access' | 'teacher-line' | 'task-link' | 'admin-login';

type ChallengeStatus = 'PENDING' | 'CLAIMED' | 'APPROVED';

interface StoredChallenge {
  scope: AraIdChallengeScope;
  subjectId: string;
  /** Flow-specific display context (school, teacher name, binding token…). */
  context: Record<string, unknown>;
  referenceCode: string;
  status: ChallengeStatus;
  entryExpiresAt: number;
  expiresAt: number;
}

interface StoredAuthorization {
  challengeKey: string;
  expiresAt: number;
  /**
   * The AraID session must have been PIN-authenticated after the challenge was
   * claimed — an older session cannot approve it.
   */
  minimumAuthenticatedAt: number;
}

export interface AraIdChallenge extends StoredChallenge {
  token: string;
}

export const ARAID_CHALLENGE_ENTRY_TTL_SECONDS = 90;
export const ARAID_CHALLENGE_AUTHORIZATION_TTL_SECONDS = 10 * 60;

@Injectable()
export class AraIdChallengeStore {
  private readonly memory = new Map<string, StoredChallenge>();
  private readonly memoryAuthorizations = new Map<string, StoredAuthorization>();

  constructor(private readonly redisClientService: RedisClientService) {}

  async create(
    scope: AraIdChallengeScope,
    subjectId: string,
    context: Record<string, unknown> = {},
  ): Promise<AraIdChallenge> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + ARAID_CHALLENGE_ENTRY_TTL_SECONDS * 1000;
    const stored: StoredChallenge = {
      scope,
      subjectId,
      context,
      referenceCode: randomBytes(4).toString('hex').slice(0, 6).toUpperCase(),
      status: 'PENDING',
      entryExpiresAt: expiresAt,
      expiresAt,
    };
    const key = this.key(scope, token);
    const client = this.redisClientService.getClient();
    if (client) {
      await client.set(key, JSON.stringify(stored), 'EX', ARAID_CHALLENGE_ENTRY_TTL_SECONDS);
    } else {
      this.memory.set(key, stored);
    }
    return { token, ...stored };
  }

  async claim(
    scope: AraIdChallengeScope,
    token: string,
  ): Promise<{ authorizationToken: string; expiresAt: number } | null> {
    const challengeKey = this.key(scope, token);
    const authorizationToken = randomBytes(32).toString('base64url');
    const authorizationKey = this.authorizationKey(scope, authorizationToken);
    const expiresAt = Date.now() + ARAID_CHALLENGE_AUTHORIZATION_TTL_SECONDS * 1000;
    const authorization: StoredAuthorization = {
      challengeKey,
      expiresAt,
      minimumAuthenticatedAt: Date.now(),
    };
    const client = this.redisClientService.getClient();
    if (!client) {
      const stored = await this.read(scope, token);
      if (!stored || stored.status !== 'PENDING' || stored.entryExpiresAt <= Date.now()) {
        return null;
      }
      this.memory.set(challengeKey, { ...stored, status: 'CLAIMED', expiresAt });
      this.memoryAuthorizations.set(authorizationKey, authorization);
      return { authorizationToken, expiresAt };
    }
    const claimed = await client.eval(
      `
        local raw = redis.call('GET', KEYS[1])
        if not raw then return 0 end
        local value = cjson.decode(raw)
        if value.status ~= 'PENDING' or value.entryExpiresAt <= tonumber(ARGV[1]) then return 0 end
        value.status = 'CLAIMED'
        value.expiresAt = tonumber(ARGV[2])
        redis.call('SET', KEYS[1], cjson.encode(value), 'PX', ARGV[3])
        redis.call('SET', KEYS[2], ARGV[4], 'PX', ARGV[3])
        return 1
      `,
      2,
      challengeKey,
      authorizationKey,
      String(Date.now()),
      String(expiresAt),
      String(ARAID_CHALLENGE_AUTHORIZATION_TTL_SECONDS * 1000),
      JSON.stringify(authorization),
    );
    return Number(claimed) === 1 ? { authorizationToken, expiresAt } : null;
  }

  async resume(
    scope: AraIdChallengeScope,
    token: string,
    authorizationToken: string,
  ): Promise<{ authorizationToken: string; expiresAt: number } | null> {
    const challengeKey = this.key(scope, token);
    const authorizationKey = this.authorizationKey(scope, authorizationToken);
    const client = this.redisClientService.getClient();
    const raw = client
      ? await client.get(authorizationKey)
      : this.memoryAuthorizations.get(authorizationKey);
    if (!raw) return null;
    try {
      const authorization =
        typeof raw === 'string' ? (JSON.parse(raw) as StoredAuthorization) : raw;
      if (authorization.challengeKey !== challengeKey || authorization.expiresAt <= Date.now()) {
        return null;
      }
      const challenge = await this.read(scope, token);
      return challenge?.status === 'CLAIMED'
        ? { authorizationToken, expiresAt: authorization.expiresAt }
        : null;
    } catch {
      return null;
    }
  }

  async readAuthorization(
    scope: AraIdChallengeScope,
    authorizationToken: string,
  ): Promise<{ challenge: StoredChallenge; minimumAuthenticatedAt: number } | null> {
    const authorizationKey = this.authorizationKey(scope, authorizationToken);
    const client = this.redisClientService.getClient();
    const raw = client
      ? await client.get(authorizationKey)
      : this.memoryAuthorizations.get(authorizationKey);
    if (!raw) return null;
    let authorization: StoredAuthorization;
    try {
      authorization = typeof raw === 'string' ? (JSON.parse(raw) as StoredAuthorization) : raw;
    } catch {
      return null;
    }
    if (authorization.expiresAt <= Date.now()) return null;
    const challengeRaw = client
      ? await client.get(authorization.challengeKey)
      : this.memory.get(authorization.challengeKey);
    if (!challengeRaw) return null;
    try {
      const challenge =
        typeof challengeRaw === 'string'
          ? (JSON.parse(challengeRaw) as StoredChallenge)
          : challengeRaw;
      // A challenge minted for another flow must never satisfy this one.
      if (challenge.scope !== scope) return null;
      return challenge.status === 'CLAIMED' && challenge.expiresAt > Date.now()
        ? { challenge, minimumAuthenticatedAt: authorization.minimumAuthenticatedAt }
        : null;
    } catch {
      return null;
    }
  }

  /**
   * `result` is merged into the challenge context so the polling side can read
   * back what approval produced (the LINE flow returns a binding token there).
   */
  async approveAuthorization(
    scope: AraIdChallengeScope,
    authorizationToken: string,
    result: Record<string, unknown> = {},
  ): Promise<boolean> {
    const authorizationKey = this.authorizationKey(scope, authorizationToken);
    const client = this.redisClientService.getClient();
    if (!client) {
      const authorization = this.memoryAuthorizations.get(authorizationKey);
      if (!authorization) return false;
      const challenge = this.memory.get(authorization.challengeKey);
      if (!challenge || challenge.status !== 'CLAIMED' || challenge.expiresAt <= Date.now()) {
        return false;
      }
      this.memory.set(authorization.challengeKey, {
        ...challenge,
        context: { ...challenge.context, ...result },
        status: 'APPROVED',
      });
      this.memoryAuthorizations.delete(authorizationKey);
      return true;
    }
    const updated = await client.eval(
      `
        local authRaw = redis.call('GET', KEYS[1])
        if not authRaw then return 0 end
        local auth = cjson.decode(authRaw)
        local raw = redis.call('GET', auth.challengeKey)
        if not raw then return 0 end
        local value = cjson.decode(raw)
        if value.status ~= 'CLAIMED' then return 0 end
        value.status = 'APPROVED'
        if ARGV[1] ~= '' then
          local extra = cjson.decode(ARGV[1])
          if value.context == nil then value.context = {} end
          for field, entry in pairs(extra) do value.context[field] = entry end
        end
        local ttl = redis.call('PTTL', auth.challengeKey)
        if ttl <= 0 then return 0 end
        redis.call('SET', auth.challengeKey, cjson.encode(value), 'PX', ttl)
        redis.call('DEL', KEYS[1])
        return 1
      `,
      1,
      authorizationKey,
      Object.keys(result).length > 0 ? JSON.stringify(result) : '',
    );
    return Number(updated) === 1;
  }

  async read(scope: AraIdChallengeScope, token: string): Promise<StoredChallenge | null> {
    const key = this.key(scope, token);
    const client = this.redisClientService.getClient();
    const raw = client ? await client.get(key) : this.memory.get(key);
    if (!raw) return null;
    let stored: StoredChallenge;
    try {
      stored = typeof raw === 'string' ? (JSON.parse(raw) as StoredChallenge) : raw;
    } catch {
      return null;
    }
    if (stored.expiresAt <= Date.now()) {
      if (client) await client.del(key);
      else this.memory.delete(key);
      return null;
    }
    return stored;
  }

  async consumeApproved(
    scope: AraIdChallengeScope,
    token: string,
  ): Promise<StoredChallenge | null> {
    const key = this.key(scope, token);
    const client = this.redisClientService.getClient();
    if (!client) {
      const stored = await this.read(scope, token);
      if (!stored || stored.status !== 'APPROVED') return null;
      this.memory.delete(key);
      return stored;
    }
    const raw = await client.eval(
      `
        local raw = redis.call('GET', KEYS[1])
        if not raw then return nil end
        local value = cjson.decode(raw)
        if value.status ~= 'APPROVED' then return nil end
        redis.call('DEL', KEYS[1])
        return raw
      `,
      1,
      key,
    );
    if (typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw) as StoredChallenge;
    } catch {
      return null;
    }
  }

  private key(scope: AraIdChallengeScope, token: string): string {
    return `sts:${scope}:araid:${createHash('sha256').update(token).digest('hex')}`;
  }

  private authorizationKey(scope: AraIdChallengeScope, token: string): string {
    return `sts:${scope}:araid-auth:${createHash('sha256').update(token).digest('hex')}`;
  }
}
