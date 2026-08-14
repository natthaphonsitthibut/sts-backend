import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisClientService } from '../redis/redis-client.service';

type ChallengeStatus = 'PENDING' | 'CLAIMED' | 'APPROVED';

interface StoredChallenge {
  grantId: string;
  referenceCode: string;
  status: ChallengeStatus;
  entryExpiresAt: number;
  expiresAt: number;
}

interface StoredAuthorization {
  challengeKey: string;
  expiresAt: number;
  minimumAuthenticatedAt: number;
}

export interface TeacherAccessAraIdChallenge extends StoredChallenge {
  token: string;
}

export const TEACHER_ACCESS_ARAID_ENTRY_TTL_SECONDS = 90;
export const TEACHER_ACCESS_ARAID_AUTHORIZATION_TTL_SECONDS = 10 * 60;

@Injectable()
export class TeacherAccessAraIdChallengeStore {
  private readonly memory = new Map<string, StoredChallenge>();
  private readonly memoryAuthorizations = new Map<string, StoredAuthorization>();

  constructor(private readonly redisClientService: RedisClientService) {}

  async create(grantId: string): Promise<TeacherAccessAraIdChallenge> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + TEACHER_ACCESS_ARAID_ENTRY_TTL_SECONDS * 1000;
    const stored: StoredChallenge = {
      grantId,
      referenceCode: randomBytes(4).toString('hex').slice(0, 6).toUpperCase(),
      status: 'PENDING',
      entryExpiresAt: expiresAt,
      expiresAt,
    };
    const key = this.key(token);
    const client = this.redisClientService.getClient();
    if (client) {
      await client.set(key, JSON.stringify(stored), 'EX', TEACHER_ACCESS_ARAID_ENTRY_TTL_SECONDS);
    } else {
      this.memory.set(key, stored);
    }
    return { token, ...stored };
  }

  async claim(token: string): Promise<{ authorizationToken: string; expiresAt: number } | null> {
    const challengeKey = this.key(token);
    const authorizationToken = randomBytes(32).toString('base64url');
    const authorizationKey = this.authorizationKey(authorizationToken);
    const expiresAt = Date.now() + TEACHER_ACCESS_ARAID_AUTHORIZATION_TTL_SECONDS * 1000;
    const authorization: StoredAuthorization = {
      challengeKey,
      expiresAt,
      minimumAuthenticatedAt: Date.now(),
    };
    const client = this.redisClientService.getClient();
    if (!client) {
      const stored = await this.read(token);
      if (!stored || stored.status !== 'PENDING' || stored.entryExpiresAt <= Date.now())
        return null;
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
      String(TEACHER_ACCESS_ARAID_AUTHORIZATION_TTL_SECONDS * 1000),
      JSON.stringify(authorization),
    );
    return Number(claimed) === 1 ? { authorizationToken, expiresAt } : null;
  }

  async resume(
    token: string,
    authorizationToken: string,
  ): Promise<{ authorizationToken: string; expiresAt: number } | null> {
    const challengeKey = this.key(token);
    const authorizationKey = this.authorizationKey(authorizationToken);
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
      const challenge = await this.read(token);
      return challenge?.status === 'CLAIMED'
        ? { authorizationToken, expiresAt: authorization.expiresAt }
        : null;
    } catch {
      return null;
    }
  }

  async readAuthorization(
    authorizationToken: string,
  ): Promise<{ challenge: StoredChallenge; minimumAuthenticatedAt: number } | null> {
    const authorizationKey = this.authorizationKey(authorizationToken);
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
      return challenge.status === 'CLAIMED' && challenge.expiresAt > Date.now()
        ? { challenge, minimumAuthenticatedAt: authorization.minimumAuthenticatedAt }
        : null;
    } catch {
      return null;
    }
  }

  async approveAuthorization(authorizationToken: string): Promise<boolean> {
    const authorizationKey = this.authorizationKey(authorizationToken);
    const client = this.redisClientService.getClient();
    if (!client) {
      const authorization = this.memoryAuthorizations.get(authorizationKey);
      if (!authorization) return false;
      const challenge = this.memory.get(authorization.challengeKey);
      if (!challenge || challenge.status !== 'CLAIMED' || challenge.expiresAt <= Date.now()) {
        return false;
      }
      this.memory.set(authorization.challengeKey, { ...challenge, status: 'APPROVED' });
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
        local ttl = redis.call('PTTL', auth.challengeKey)
        if ttl <= 0 then return 0 end
        redis.call('SET', auth.challengeKey, cjson.encode(value), 'PX', ttl)
        redis.call('DEL', KEYS[1])
        return 1
      `,
      1,
      authorizationKey,
    );
    return Number(updated) === 1;
  }

  async read(token: string): Promise<StoredChallenge | null> {
    const key = this.key(token);
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

  async consumeApproved(token: string): Promise<StoredChallenge | null> {
    const key = this.key(token);
    const client = this.redisClientService.getClient();
    if (!client) {
      const stored = await this.read(token);
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

  private key(token: string): string {
    return `sts:teacher-access:araid:${createHash('sha256').update(token).digest('hex')}`;
  }

  private authorizationKey(token: string): string {
    return `sts:teacher-access:araid-auth:${createHash('sha256').update(token).digest('hex')}`;
  }
}
