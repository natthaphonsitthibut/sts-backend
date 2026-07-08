import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import Redis from 'ioredis';
import { queueConfig } from '../config/queue.config';

@Injectable()
export class RedisClientService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisClientService.name);
  private client?: Redis;

  constructor(
    @Inject(queueConfig.KEY)
    private readonly config: ConfigType<typeof queueConfig>,
  ) {
    if (config.requireRedis && !config.redisUrl) {
      throw new Error('REDIS_URL or QUEUE_REDIS_URL is required for production shared stores');
    }
  }

  getClient(): Redis | undefined {
    if (!this.config.redisUrl) {
      return undefined;
    }
    if (!this.client) {
      this.client = new Redis(this.config.redisUrl, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
      });
      this.client.on('error', (error) => {
        this.logger.error(`Redis shared store error: ${this.errorMessage(error)}`);
      });
    }
    return this.client;
  }

  async onModuleInit(): Promise<void> {
    if (!this.config.requireRedis) {
      return;
    }
    const client = this.getClient();
    if (!client) {
      return;
    }
    await client.ping();
  }

  async onApplicationShutdown(): Promise<void> {
    const client = this.getClient();
    if (!client) {
      return;
    }
    await client.quit().catch(() => {
      client.disconnect();
    });
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
