import * as crypto from 'crypto';
import { TeacherAccessOtpStore } from './teacher-access-otp.store';

interface FakeStoredOtp {
  codeHash: string;
  expiresAt: number;
  attempts: number;
  lockedUntil: number | null;
}

class AtomicRedisFake {
  readonly values = new Map<string, string>();
  failEval = false;

  set(key: string, value: string): Promise<'OK'> {
    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.values.delete(key) ? 1 : 0);
  }

  eval(
    _script: string,
    _keyCount: number,
    key: string,
    providedHash: string,
    nowInput: number,
    maxAttemptsInput: number,
    lockMsInput: number,
  ): Promise<number> {
    if (this.failEval) return Promise.reject(new Error('redis unavailable'));
    const raw = this.values.get(key);
    if (!raw) return Promise.resolve(5);
    const stored = JSON.parse(raw) as FakeStoredOtp;
    const now = Number(nowInput);
    if (stored.lockedUntil && stored.lockedUntil > now) return Promise.resolve(3);
    if (stored.expiresAt <= now) return Promise.resolve(4);
    if (stored.codeHash === providedHash) {
      this.values.delete(key);
      return Promise.resolve(1);
    }
    stored.attempts += 1;
    if (stored.attempts >= Number(maxAttemptsInput)) {
      stored.lockedUntil = now + Number(lockMsInput);
      this.values.set(key, JSON.stringify(stored));
      return Promise.resolve(3);
    }
    this.values.set(key, JSON.stringify(stored));
    return Promise.resolve(2);
  }
}

describe('TeacherAccessOtpStore', () => {
  const config = {
    sessionSecret: 'test-session-secret-not-production',
    otpTtlSeconds: 600,
    otpMaxAttempts: 3,
    otpLockSeconds: 900,
  };

  function createStore(redis?: AtomicRedisFake): TeacherAccessOtpStore {
    return new TeacherAccessOtpStore({ getClient: () => redis } as never, config as never);
  }

  it('atomically caps concurrent wrong guesses at the configured limit', async () => {
    const redis = new AtomicRedisFake();
    const store = createStore(redis);
    await store.issue('grant-1', '123456');

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => store.verify('grant-1', '000000')),
    );

    expect(outcomes.filter((outcome) => outcome === 'wrong')).toHaveLength(2);
    expect(outcomes.filter((outcome) => outcome === 'locked')).toHaveLength(6);
    const stored = JSON.parse(redis.values.get('sts:teacher-access-otp:grant-1')!) as FakeStoredOtp;
    expect(stored.attempts).toBe(3);
  });

  it('consumes a valid code once', async () => {
    const redis = new AtomicRedisFake();
    const store = createStore(redis);
    await store.issue('grant-1', '123456');

    await expect(store.verify('grant-1', '123456')).resolves.toBe('ok');
    await expect(store.verify('grant-1', '123456')).resolves.toBe('missing');
  });

  it('propagates Redis failures instead of treating them as a missing OTP', async () => {
    const redis = new AtomicRedisFake();
    const store = createStore(redis);
    await store.issue('grant-1', '123456');
    redis.failEval = true;

    await expect(store.verify('grant-1', '123456')).rejects.toThrow('redis unavailable');
  });

  it('hashes issued codes before storing them', async () => {
    const redis = new AtomicRedisFake();
    const store = createStore(redis);
    await store.issue('grant-1', '123456');

    const stored = redis.values.get('sts:teacher-access-otp:grant-1') ?? '';
    expect(stored).not.toContain('123456');
    expect(stored).toContain(
      crypto.createHash('sha256').update(`${config.sessionSecret}:123456`).digest('hex'),
    );
  });
});
