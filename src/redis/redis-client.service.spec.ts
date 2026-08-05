import { RedisClientService } from './redis-client.service';
import type { QueueRuntimeConfig } from '../config/queue.config';

function config(overrides: Partial<QueueRuntimeConfig> = {}): QueueRuntimeConfig {
  return {
    redisUrl: undefined,
    requireRedis: false,
    studentAccountBatch: {
      queueName: 'student-account-batch',
      attempts: 3,
      backoffMs: 30_000,
    },
    riskProfile: {
      queueName: 'student-risk-profile',
      attempts: 3,
      backoffMs: 30_000,
    },
    dataExport: {
      queueName: 'data-export',
      attempts: 3,
      backoffMs: 30_000,
      artifactTtlHours: 24,
      storagePrefix: 'data-exports/',
    },
    ...overrides,
  };
}

describe('RedisClientService', () => {
  it('fails startup config when production requires Redis without a URL', () => {
    expect(() => new RedisClientService(config({ requireRedis: true }))).toThrow(
      'REDIS_URL is required for production shared stores',
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
