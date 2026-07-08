import { RedisClientService } from './redis-client.service';
import type { QueueRuntimeConfig } from '../config/queue.config';

function config(overrides: Partial<QueueRuntimeConfig> = {}): QueueRuntimeConfig {
  return {
    redisUrl: undefined,
    requireRedis: false,
    studentAccountBatch: {
      mode: 'inline',
      queueName: 'student-account-batch',
      attempts: 3,
      backoffMs: 30_000,
    },
    riskProfile: {
      mode: 'inline',
      queueName: 'student-risk-profile',
      attempts: 3,
      backoffMs: 30_000,
    },
    ...overrides,
  };
}

describe('RedisClientService', () => {
  it('fails startup config when production requires Redis without a URL', () => {
    expect(() => new RedisClientService(config({ requireRedis: true }))).toThrow(
      'REDIS_URL or QUEUE_REDIS_URL is required for production shared stores',
    );
  });

  it('pings Redis during required production startup', async () => {
    const service = new RedisClientService(
      config({ redisUrl: 'redis://localhost:6379', requireRedis: true }),
    );
    const client = {
      ping: jest.fn().mockResolvedValue('PONG'),
      quit: jest.fn().mockResolvedValue('OK'),
      disconnect: jest.fn(),
    };
    jest.spyOn(service, 'getClient').mockReturnValue(client as never);

    await service.onModuleInit();
    await service.onApplicationShutdown();

    expect(client.ping).toHaveBeenCalled();
    expect(client.quit).toHaveBeenCalled();
  });
});
