import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { authConfig } from '../config/auth.config';
import { RedisClientService } from '../redis/redis-client.service';

/**
 * One AraID QR-approval mechanism for every flow that needs it.
 *
 * The LINE invitation and the follow-up/assistance task link approve the same
 * way — issue a short-lived challenge, let the
 * AraID app claim it, require a fresh PIN, then approve and hand back a session.
 * Only the subject being approved differs, so it is a `scope` + `subjectId`
 * here rather than a copy of this file per flow.
 *
 * `scope` is part of the Redis key, so a challenge minted for one flow can never
 * be redeemed by another, and the existing per-flow keys stay byte-identical.
 */
export type AraIdChallengeScope =
  | 'teacher-line'
  | 'task-link'
  | 'admin-login'
  | 'classroom-check-in';

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

@Injectable()
export class AraIdChallengeStore {
  private readonly memory = new Map<string, StoredChallenge>();
  private readonly memoryAuthorizations = new Map<string, StoredAuthorization>();

  constructor(
    private readonly redisClientService: RedisClientService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async create(
    scope: AraIdChallengeScope,
    subjectId: string,
    context: Record<string, unknown> = {},
  ): Promise<AraIdChallenge> {
    this.pruneMemory();
    const token = randomBytes(32).toString('base64url');
    const entryTtlSeconds = this.config.araIdChallengeEntryTtlSeconds;
    const expiresAt = Date.now() + entryTtlSeconds * 1000;
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
      await client.set(key, JSON.stringify(stored), 'EX', entryTtlSeconds);
    } else {
      this.memory.set(key, stored);
    }
    return { token, ...stored };
  }

  /**
   * Hands the scanning device an authorization for this challenge.
   *
   * A first visit claims a `PENDING` challenge. A repeat visit — a refresh, a
   * second tab, a back button — finds it already `CLAIMED` and gets a fresh
   * authorization for the same challenge instead of an error, because the real
   * gate is the AraID identity match plus a PIN entered after this moment, not
   * the claim itself. The renewal never extends the original window and always
   * resets `minimumAuthenticatedAt`, so a PIN typed before it cannot be reused.
   */
  async claimOrRenew(
    scope: AraIdChallengeScope,
    token: string,
  ): Promise<{ authorizationToken: string; expiresAt: number } | null> {
    this.pruneMemory();
    const challengeKey = this.key(scope, token);
    const authorizationToken = randomBytes(32).toString('base64url');
    const authorizationKey = this.authorizationKey(scope, authorizationToken);
    const now = Date.now();
    const claimedExpiresAt = now + this.config.araIdChallengeAuthorizationTtlSeconds * 1000;
    const client = this.redisClientService.getClient();
    if (!client) {
      const stored = await this.read(scope, token);
      if (!stored) return null;
      let expiresAt: number;
      if (stored.status === 'PENDING') {
        if (stored.entryExpiresAt <= now) return null;
        expiresAt = claimedExpiresAt;
      } else if (stored.status === 'CLAIMED') {
        if (stored.expiresAt <= now) return null;
        expiresAt = stored.expiresAt;
      } else {
        return null;
      }
      this.memory.set(challengeKey, { ...stored, status: 'CLAIMED', expiresAt });
      this.memoryAuthorizations.set(authorizationKey, {
        challengeKey,
        expiresAt,
        minimumAuthenticatedAt: now,
      });
      return { authorizationToken, expiresAt };
    }
    const effectiveExpiresAt = await client.eval(
      `
        local raw = redis.call('GET', KEYS[1])
        if not raw then return 0 end
        local value = cjson.decode(raw)
        local now = tonumber(ARGV[1])
        if value.status == 'PENDING' then
          if value.entryExpiresAt <= now then return 0 end
          value.expiresAt = tonumber(ARGV[2])
        elseif value.status == 'CLAIMED' then
          if value.expiresAt <= now then return 0 end
        else
          return 0
        end
        value.status = 'CLAIMED'
        -- Redis rejects a fractional PX, and the Lua bridge truncates the
        -- return value anyway, so keep both as whole milliseconds.
        local ttl = math.floor(value.expiresAt - now)
        if ttl <= 0 then return 0 end
        redis.call('SET', KEYS[1], cjson.encode(value), 'PX', ttl)
        redis.call('SET', KEYS[2], cjson.encode({
          challengeKey = KEYS[1],
          expiresAt = value.expiresAt,
          minimumAuthenticatedAt = now
        }), 'PX', ttl)
        return math.floor(value.expiresAt)
      `,
      2,
      challengeKey,
      authorizationKey,
      String(now),
      String(claimedExpiresAt),
    );
    const expiresAt = Number(effectiveExpiresAt);
    return expiresAt > 0 ? { authorizationToken, expiresAt } : null;
  }

  async resume(
    scope: AraIdChallengeScope,
    token: string,
    authorizationToken: string,
  ): Promise<{ authorizationToken: string; expiresAt: number } | null> {
    this.pruneMemory();
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
    this.pruneMemory();
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
    this.pruneMemory();
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
    this.pruneMemory();
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
    this.pruneMemory();
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

  private pruneMemory(): void {
    const now = Date.now();
    for (const [key, value] of this.memory) {
      const expiresAt = value.status === 'PENDING' ? value.entryExpiresAt : value.expiresAt;
      if (expiresAt <= now) this.memory.delete(key);
    }
    for (const [key, value] of this.memoryAuthorizations) {
      if (value.expiresAt <= now || !this.memory.has(value.challengeKey)) {
        this.memoryAuthorizations.delete(key);
      }
    }
  }
}
