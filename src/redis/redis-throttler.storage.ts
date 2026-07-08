import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { RedisClientService } from './redis-client.service';

const THROTTLE_INCREMENT_SCRIPT = `
local hitKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blockTtl = redis.call('PTTL', blockKey)
if blockTtl > 0 then
  local hits = tonumber(redis.call('GET', hitKey) or limit + 1)
  local hitTtl = redis.call('PTTL', hitKey)
  if hitTtl < 0 then
    hitTtl = ttl
  end
  return { hits, hitTtl, 1, blockTtl }
end

local hits = redis.call('INCR', hitKey)
local hitTtl = redis.call('PTTL', hitKey)
if hitTtl < 0 then
  redis.call('PEXPIRE', hitKey, ttl)
  hitTtl = ttl
end

if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', blockDuration)
  return { hits, hitTtl, 1, blockDuration }
end

return { hits, hitTtl, 0, 0 }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly fallback = new ThrottlerStorageService();

  constructor(private readonly redisClientService: RedisClientService) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const client = this.redisClientService.getClient();
    if (!client) {
      return await this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    }

    const hitKey = this.key(throttlerName, key, 'hits');
    const blockKey = this.key(throttlerName, key, 'block');
    const result = (await client.eval(
      THROTTLE_INCREMENT_SCRIPT,
      2,
      hitKey,
      blockKey,
      String(ttl),
      String(limit),
      String(blockDuration),
    )) as [number, number, number, number];

    const [totalHits, timeToExpireMs, isBlocked, timeToBlockExpireMs] = result;
    return {
      totalHits: Number(totalHits),
      timeToExpire: this.msToSeconds(Number(timeToExpireMs)),
      isBlocked: Number(isBlocked) === 1,
      timeToBlockExpire: this.msToSeconds(Number(timeToBlockExpireMs)),
    };
  }

  private key(throttlerName: string, key: string, suffix: 'hits' | 'block'): string {
    return `sts:throttle:${throttlerName}:${key}:${suffix}`;
  }

  private msToSeconds(value: number): number {
    return value > 0 ? Math.ceil(value / 1000) : 0;
  }

  onApplicationShutdown(): void {
    this.fallback.onApplicationShutdown();
  }
}
