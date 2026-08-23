import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { authConfig } from '../config/auth.config';
import { RedisClientService } from '../redis/redis-client.service';

interface GoogleLoginState {
  linkId: string;
  tokenHash: string;
  nonce: string;
  expiresAt: number;
}

@Injectable()
export class GoogleLoginStateStore {
  private readonly memory = new Map<string, GoogleLoginState>();

  constructor(
    private readonly redis: RedisClientService,
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  async create(linkId: string, tokenHash: string): Promise<{ state: string; nonce: string }> {
    this.pruneMemory();
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const payload: GoogleLoginState = {
      linkId,
      tokenHash,
      nonce,
      expiresAt: Date.now() + Math.min(this.auth.magicSessionTtlSeconds, 600) * 1000,
    };
    const client = this.redis.getClient();
    if (client) {
      await client.set(this.key(state), JSON.stringify(payload), 'EX', 600);
    } else {
      this.pruneMemory();
      this.memory.set(this.key(state), payload);
    }
    return { state, nonce };
  }

  async consume(state: string): Promise<GoogleLoginState | null> {
    const key = this.key(state);
    const client = this.redis.getClient();
    let raw: string | null = null;
    if (client) {
      raw = (await client.eval(
        `local value = redis.call('GET', KEYS[1]); if value then redis.call('DEL', KEYS[1]) end; return value`,
        1,
        key,
      )) as string | null;
    } else {
      this.pruneMemory();
      const stored = this.memory.get(key);
      this.memory.delete(key);
      raw = stored ? JSON.stringify(stored) : null;
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as GoogleLoginState;
      return parsed.expiresAt > Date.now() ? parsed : null;
    } catch {
      return null;
    }
  }

  private pruneMemory(): void {
    const now = Date.now();
    for (const [key, value] of this.memory) {
      if (value.expiresAt <= now) this.memory.delete(key);
    }
  }

  private key(state: string): string {
    return `sts:classroom-google-state:${createHash('sha256').update(state).digest('hex')}`;
  }
}
