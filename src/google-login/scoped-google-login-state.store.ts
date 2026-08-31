import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { authConfig } from '../config/auth.config';
import { RedisClientService } from '../redis/redis-client.service';

/**
 * A Google authorization round trip is a browser redirect, not a session: the
 * state only has to outlive the hop to Google and back. Capping it here keeps a
 * longer `MAGIC_SESSION_TTL_SECONDS` from widening the replay window.
 */
const GOOGLE_LOGIN_STATE_MAX_TTL_SECONDS = 600;

export type GoogleLoginFlow = 'classroom-link' | 'task-link' | 'teacher-line-group';

export interface ScopedGoogleLoginState {
  flow: GoogleLoginFlow;
  /** Id of the link the state belongs to; re-checked against the live row on callback. */
  subjectId: string;
  tokenHash: string;
  schoolId: number;
  nonce: string;
  expiresAt: number;
}

@Injectable()
export class ScopedGoogleLoginStateStore {
  private readonly memory = new Map<string, ScopedGoogleLoginState>();

  constructor(
    private readonly redis: RedisClientService,
    @Inject(authConfig.KEY) private readonly auth: ConfigType<typeof authConfig>,
  ) {}

  async create(
    flow: GoogleLoginFlow,
    input: Omit<ScopedGoogleLoginState, 'flow' | 'nonce' | 'expiresAt'>,
  ): Promise<{ state: string; nonce: string }> {
    this.pruneMemory();
    const state = randomBytes(32).toString('base64url');
    const nonce = randomBytes(24).toString('base64url');
    const ttlSeconds = Math.min(
      this.auth.magicSessionTtlSeconds,
      GOOGLE_LOGIN_STATE_MAX_TTL_SECONDS,
    );
    const payload: ScopedGoogleLoginState = {
      ...input,
      flow,
      nonce,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    const client = this.redis.getClient();
    if (client) {
      await client.set(this.key(flow, state), JSON.stringify(payload), 'EX', ttlSeconds);
    } else {
      this.memory.set(this.key(flow, state), payload);
    }
    return { state, nonce };
  }

  async consume(flow: GoogleLoginFlow, state: string): Promise<ScopedGoogleLoginState | null> {
    const key = this.key(flow, state);
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
      const parsed = JSON.parse(raw) as ScopedGoogleLoginState;
      return parsed.flow === flow && parsed.expiresAt > Date.now() ? parsed : null;
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

  private key(flow: GoogleLoginFlow, state: string): string {
    const digest = createHash('sha256').update(state).digest('hex');
    return `sts:google-login:${flow}:${digest}`;
  }
}
