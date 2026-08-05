import { RedisThrottlerStorage } from './redis-throttler.storage';
import { RedisClientService } from './redis-client.service';

describe('RedisThrottlerStorage', () => {
  let storage: RedisThrottlerStorage | undefined;

  afterEach(() => {
    storage?.onApplicationShutdown();
    storage = undefined;
  });

  it('falls back to the in-memory throttler store without Redis', async () => {
    storage = new RedisThrottlerStorage({
      getClient: jest.fn().mockReturnValue(undefined),
    } as unknown as RedisClientService);

    const first = await storage.increment('key', 1_000, 1, 1_000, 'login');
    const second = await storage.increment('key', 1_000, 1, 1_000, 'login');

    expect(first.isBlocked).toBe(false);
    expect(second.isBlocked).toBe(true);
  });

  it('increments counters through Redis when configured', async () => {
    const redis = {
      eval: jest.fn().mockResolvedValue([2, 45_000, 1, 30_000]),
    };
    storage = new RedisThrottlerStorage({
      getClient: jest.fn().mockReturnValue(redis),
    } as unknown as RedisClientService);

    const result = await storage.increment('hashed-key', 60_000, 1, 30_000, 'otpVerify');

    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'sts:throttle:otpVerify:hashed-key:hits',
      'sts:throttle:otpVerify:hashed-key:block',
      '60000',
      '1',
      '30000',
    );
    expect(result).toEqual({
      totalHits: 2,
      timeToExpire: 45,
      isBlocked: true,
      timeToBlockExpire: 30,
    });
  });
});
