import * as crypto from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { authConfig } from '../../config/auth.config';
import { RedisClientService } from '../../redis/redis-client.service';

export type OtpOutcome = 'ok' | 'locked' | 'expired' | 'wrong' | 'missing';

interface StoredOtp {
  codeHash: string;
  expiresAt: number;
  attempts: number;
  lockedUntil: number | null;
}

const VERIFY_OTP_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 5 end

local stored = cjson.decode(raw)
local now = tonumber(ARGV[2])
local lockedUntil = stored.lockedUntil
if lockedUntil ~= nil and lockedUntil ~= cjson.null and tonumber(lockedUntil) > now then
  return 3
end
if tonumber(stored.expiresAt) <= now then return 4 end

if stored.codeHash == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end

stored.attempts = tonumber(stored.attempts) + 1
if stored.attempts >= tonumber(ARGV[3]) then
  stored.lockedUntil = now + tonumber(ARGV[4])
  redis.call('SET', KEYS[1], cjson.encode(stored), 'PX', ARGV[5])
  return 3
end

redis.call('SET', KEYS[1], cjson.encode(stored), 'PX', ARGV[5])
return 2
`;

const OTP_OUTCOME_BY_CODE: Record<number, OtpOutcome> = {
  1: 'ok',
  2: 'wrong',
  3: 'locked',
  4: 'expired',
  5: 'missing',
};

/**
 * Shared one-time-code state: issue, compare, and the brute-force counter that
 * makes the comparison safe. Teacher access links and LINE account linking both
 * verify an emailed code, so the lockout logic lives here once instead of being
 * reimplemented per feature (same reason `EmailService` sits in common).
 *
 * `key` is whatever the caller wants a code to be scoped to — a grant id, a
 * teacher id — namespaced by the caller so two features cannot collide.
 *
 * State lives in Redis rather than a table: it is short-lived, write-heavy and
 * has to be shared across instances. The code is stored hashed so a Redis dump
 * never yields a usable one-time code.
 *
 * Without Redis configured (local dev), a per-process map stands in. That is
 * explicitly single-instance behaviour — production sets `requireRedis`.
 */
@Injectable()
export class OtpStore {
  private readonly memory = new Map<string, StoredOtp>();
  private readonly memoryExpiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly redisClientService: RedisClientService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  /** Stores a freshly issued code, clearing any previous attempts/lock. */
  async issue(key: string, code: string): Promise<Date> {
    const expiresAt = new Date(Date.now() + this.config.otpTtlSeconds * 1000);
    await this.write(key, {
      codeHash: this.hash(code),
      expiresAt: expiresAt.getTime(),
      attempts: 0,
      lockedUntil: null,
    });
    return expiresAt;
  }

  /**
   * Compares a submitted code and advances the brute-force counter in the same
   * step, so a wrong guess always costs an attempt.
   */
  async verify(key: string, code: string): Promise<OtpOutcome> {
    const client = this.redisClientService.getClient();
    if (!client) return this.verifyMemory(key, code);

    const retentionMs =
      (Math.max(this.config.otpTtlSeconds, this.config.otpLockSeconds) + 60) * 1000;
    const result = Number(
      await client.eval(
        VERIFY_OTP_SCRIPT,
        1,
        this.redisKey(key),
        this.hash(code),
        Date.now(),
        this.config.otpMaxAttempts,
        this.config.otpLockSeconds * 1000,
        retentionMs,
      ),
    );
    const outcome = OTP_OUTCOME_BY_CODE[result];
    if (!outcome) throw new Error('OTP store returned an invalid outcome');
    return outcome;
  }

  private verifyMemory(key: string, code: string): OtpOutcome {
    const stored = this.memory.get(key);
    if (!stored) return 'missing';

    const now = Date.now();
    if (stored.lockedUntil && stored.lockedUntil > now) return 'locked';
    if (stored.expiresAt <= now) return 'expired';

    const expected = Buffer.from(stored.codeHash);
    const provided = Buffer.from(this.hash(code));
    const matches =
      expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
    if (matches) {
      this.clearMemory(key);
      return 'ok';
    }

    const attempts = stored.attempts + 1;
    const locked = attempts >= this.config.otpMaxAttempts;
    this.memory.set(key, {
      ...stored,
      attempts,
      lockedUntil: locked ? now + this.config.otpLockSeconds * 1000 : stored.lockedUntil,
    });
    return locked ? 'locked' : 'wrong';
  }

  async clear(key: string): Promise<void> {
    const client = this.redisClientService.getClient();
    if (!client) {
      this.clearMemory(key);
      return;
    }
    await client.del(this.redisKey(key));
  }

  private async write(key: string, value: StoredOtp): Promise<void> {
    // The record must outlive the code itself so a lock survives the code's own
    // expiry — otherwise a locked-out guesser could just request nothing, wait
    // out the TTL and start over with a clean counter.
    const ttlSeconds = Math.max(this.config.otpTtlSeconds, this.config.otpLockSeconds) + 60;
    const client = this.redisClientService.getClient();
    if (!client) {
      this.clearMemory(key);
      this.memory.set(key, value);
      const timer = setTimeout(() => this.clearMemory(key), ttlSeconds * 1000);
      timer.unref?.();
      this.memoryExpiryTimers.set(key, timer);
      return;
    }
    await client.set(this.redisKey(key), JSON.stringify(value), 'EX', ttlSeconds);
  }

  private hash(code: string): string {
    return crypto.createHash('sha256').update(`${this.config.sessionSecret}:${code}`).digest('hex');
  }

  private redisKey(key: string): string {
    return `sts:otp:${key}`;
  }

  private clearMemory(key: string): void {
    this.memory.delete(key);
    const timer = this.memoryExpiryTimers.get(key);
    if (timer) clearTimeout(timer);
    this.memoryExpiryTimers.delete(key);
  }
}
