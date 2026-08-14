import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisClientService } from '../redis/redis-client.service';

type ChallengeStatus = 'PENDING' | 'CLAIMED' | 'APPROVED';

interface StoredChallenge {
  invitationId: string;
  schoolId: number;
  schoolName: string;
  referenceCode: string;
  status: ChallengeStatus;
  entryExpiresAt: number;
  expiresAt: number;
  bindingToken?: string;
  teacherName?: string;
}

export interface TeacherLineAraIdChallenge extends StoredChallenge {
  token: string;
}

interface StoredAuthorization {
  challengeKey: string;
  expiresAt: number;
}

const CHALLENGE_TTL_SECONDS = 90;
const AUTHORIZATION_TTL_SECONDS = 10 * 60;

@Injectable()
export class TeacherLineAraIdChallengeStore {
  private readonly memory = new Map<string, StoredChallenge>();
  private readonly memoryAuthorizations = new Map<string, StoredAuthorization>();

  constructor(private readonly redisClientService: RedisClientService) {}

  async create(input: {
    invitationId: string;
    schoolId: number;
    schoolName: string;
  }): Promise<TeacherLineAraIdChallenge> {
    const token = randomBytes(32).toString('base64url');
    const stored: StoredChallenge = {
      ...input,
      referenceCode: randomBytes(4).toString('hex').slice(0, 6).toUpperCase(),
      status: 'PENDING',
      entryExpiresAt: Date.now() + CHALLENGE_TTL_SECONDS * 1000,
      expiresAt: Date.now() + CHALLENGE_TTL_SECONDS * 1000,
    };
    const key = this.key(token);
    const client = this.redisClientService.getClient();
    if (client) await client.set(key, JSON.stringify(stored), 'EX', CHALLENGE_TTL_SECONDS);
    else this.memory.set(key, stored);
    return { token, ...stored };
  }

  async claim(token: string): Promise<{ authorizationToken: string; expiresAt: number } | null> {
    const challengeKey = this.key(token);
    const authorizationToken = randomBytes(32).toString('base64url');
    const authorizationKey = this.authorizationKey(authorizationToken);
    const expiresAt = Date.now() + AUTHORIZATION_TTL_SECONDS * 1000;
    const authorization: StoredAuthorization = { challengeKey, expiresAt };
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
      String(AUTHORIZATION_TTL_SECONDS * 1000),
      JSON.stringify(authorization),
    );
    return Number(claimed) === 1 ? { authorizationToken, expiresAt } : null;
  }

  async readAuthorization(authorizationToken: string): Promise<StoredChallenge | null> {
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
      return challenge.status === 'CLAIMED' && challenge.expiresAt > Date.now() ? challenge : null;
    } catch {
      return null;
    }
  }

  async approveAuthorization(
    authorizationToken: string,
    result: { bindingToken: string; teacherName: string },
  ): Promise<boolean> {
    const authorizationKey = this.authorizationKey(authorizationToken);
    const client = this.redisClientService.getClient();
    if (!client) {
      const authorizationRaw = this.memoryAuthorizations.get(authorizationKey);
      if (!authorizationRaw) return false;
      const challenge = this.memory.get(authorizationRaw.challengeKey);
      if (!challenge || challenge.status !== 'CLAIMED' || challenge.expiresAt <= Date.now()) {
        return false;
      }
      this.memory.set(authorizationRaw.challengeKey, {
        ...challenge,
        ...result,
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
        value.bindingToken = ARGV[1]
        value.teacherName = ARGV[2]
        local ttl = redis.call('PTTL', auth.challengeKey)
        if ttl <= 0 then return 0 end
        redis.call('SET', auth.challengeKey, cjson.encode(value), 'PX', ttl)
        redis.call('DEL', KEYS[1])
        return 1
      `,
      1,
      authorizationKey,
      result.bindingToken,
      result.teacherName,
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
    return `sts:line-link:araid:${createHash('sha256').update(token).digest('hex')}`;
  }

  private authorizationKey(token: string): string {
    return `sts:line-link:araid-auth:${createHash('sha256').update(token).digest('hex')}`;
  }
}
