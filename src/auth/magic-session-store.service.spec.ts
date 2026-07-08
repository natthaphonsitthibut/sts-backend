import * as crypto from 'crypto';
import { MagicSessionStoreService } from './magic-session-store.service';
import { RedisClientService } from '../redis/redis-client.service';
import type { AuthRuntimeConfig } from '../config/auth.config';

const authConfig: AuthRuntimeConfig = {
  jwtSecret: 'test-jwt-secret-value',
  sessionSecret: 'test-session-secret-value',
  magicSessionTtlSeconds: 60,
  otpTtlSeconds: 60,
  otpMaxAttempts: 5,
  otpLockSeconds: 60,
  cookieName: 'sts_session',
  cookieSecure: false,
  cookieSameSite: 'lax',
  tokenTtlSeconds: 60,
  thaidMode: 'mock',
};

function signMagicSession(payload: Record<string, unknown>, secret: string): string {
  const serialized = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', secret).update(serialized).digest('hex');
  return `${Buffer.from(serialized).toString('base64')}.${signature}`;
}

describe('MagicSessionStoreService', () => {
  it('falls back to signed sessions when Redis is not configured', async () => {
    const service = new MagicSessionStoreService(
      { getClient: jest.fn().mockReturnValue(undefined) } as unknown as RedisClientService,
      authConfig,
    );

    const token = await service.issue('link-1');

    await expect(service.isVerified('link-1', token)).resolves.toBe(true);
  });

  it('rejects expired fallback signed sessions', async () => {
    const service = new MagicSessionStoreService(
      { getClient: jest.fn().mockReturnValue(undefined) } as unknown as RedisClientService,
      authConfig,
    );
    const token = signMagicSession(
      { link_id: 'link-1', verified: true, ts: Date.now() - 61_000 },
      authConfig.sessionSecret,
    );

    await expect(service.isVerified('link-1', token)).resolves.toBe(false);
  });

  it('stores opaque sessions in Redis with the configured TTL', async () => {
    const redis = {
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn(),
    };
    redis.get.mockImplementation((key: string): Promise<string | null> => {
      const calls = redis.set.mock.calls as Array<[string, string, 'EX', number]>;
      const [storedKey, storedValue] = calls[0] ?? [];
      return Promise.resolve(key === storedKey ? storedValue : null);
    });
    const service = new MagicSessionStoreService(
      { getClient: jest.fn().mockReturnValue(redis) } as unknown as RedisClientService,
      authConfig,
    );

    const token = await service.issue('link-1');

    expect(token).toMatch(/^ms_/);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^sts:magic-session:/),
      expect.any(String),
      'EX',
      authConfig.magicSessionTtlSeconds,
    );
    await expect(service.isVerified('link-1', token)).resolves.toBe(true);
  });

  it('does not accept legacy signed tokens when Redis is configured', async () => {
    const service = new MagicSessionStoreService(
      {
        getClient: jest.fn().mockReturnValue({
          get: jest.fn().mockResolvedValue(null),
        }),
      } as unknown as RedisClientService,
      authConfig,
    );
    const token = signMagicSession(
      { link_id: 'link-1', verified: true, ts: Date.now() },
      authConfig.sessionSecret,
    );

    await expect(service.isVerified('link-1', token)).resolves.toBe(false);
  });
});
