import { randomBytes, createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { RedisClientService } from '../redis/redis-client.service';

/** Proof that the holder passed the email OTP for a specific teacher. */
export interface TeacherLineBindingSession {
  teacherId: string;
  email: string;
}

/** One in-flight sign-in: ties the provider's `state` back to a binding session. */
export interface TeacherLineOAuthState {
  bindingToken: string;
  teacherId: string;
  nonce: string;
}

const BINDING_TTL_SECONDS = 900; // 15 min: long enough to add the OA and come back.
const OAUTH_STATE_TTL_SECONDS = 600;

interface StoredValue<T> {
  value: T;
  expiresAt: number;
}

/**
 * Short-lived state for the LINE linking flow.
 *
 * Deliberately not in Postgres: both records live for minutes, are written once
 * and read once, and must be shared across instances — the same reasoning as the
 * OTP store next to it. Without Redis a per-process map stands in, which is
 * single-instance behaviour and fine for local development only.
 *
 * Binding tokens are stored hashed, so a Redis dump cannot be replayed into
 * someone else's linking flow.
 */
@Injectable()
export class TeacherLineSessionStore {
  private readonly memory = new Map<string, StoredValue<unknown>>();

  constructor(private readonly redisClientService: RedisClientService) {}

  /** Issued once the OTP is verified; the raw token goes to the browser only. */
  async createBindingSession(session: TeacherLineBindingSession): Promise<string> {
    const token = randomBytes(32).toString('hex');
    await this.write(this.bindingKey(token), session, BINDING_TTL_SECONDS);
    return token;
  }

  async readBindingSession(token: string): Promise<TeacherLineBindingSession | null> {
    if (!token) return null;
    return await this.read<TeacherLineBindingSession>(this.bindingKey(token));
  }

  async clearBindingSession(token: string): Promise<void> {
    await this.remove(this.bindingKey(token));
  }

  async createOAuthState(state: TeacherLineOAuthState): Promise<string> {
    const value = randomBytes(24).toString('hex');
    await this.write(this.stateKey(value), state, OAUTH_STATE_TTL_SECONDS);
    return value;
  }

  /**
   * Reads and deletes in one step: a `state` is single-use, so a replayed
   * callback finds nothing even if the original redirect is repeated.
   */
  async consumeOAuthState(state: string): Promise<TeacherLineOAuthState | null> {
    if (!state) return null;
    const key = this.stateKey(state);
    const client = this.redisClientService.getClient();
    if (!client) {
      const stored = this.memory.get(key);
      if (!stored) return null;
      // Delete synchronously before yielding so concurrent callbacks cannot
      // observe the same value in the in-memory development store.
      this.memory.delete(key);
      if (stored.expiresAt <= Date.now()) return null;
      return stored.value as TeacherLineOAuthState;
    }

    // Redis GET + DEL must be one server-side operation. A separate read and
    // remove lets two app instances accept the same OAuth callback replay.
    const raw = await client.eval(
      `
        local value = redis.call('GET', KEYS[1])
        if value then redis.call('DEL', KEYS[1]) end
        return value
      `,
      1,
      key,
    );
    if (typeof raw !== 'string') return null;
    try {
      return JSON.parse(raw) as TeacherLineOAuthState;
    } catch {
      return null;
    }
  }

  private async write(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const client = this.redisClientService.getClient();
    if (!client) {
      this.memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return;
    }
    await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  private async read<T>(key: string): Promise<T | null> {
    const client = this.redisClientService.getClient();
    if (!client) {
      const stored = this.memory.get(key);
      if (!stored) return null;
      if (stored.expiresAt <= Date.now()) {
        this.memory.delete(key);
        return null;
      }
      return stored.value as T;
    }
    const raw = await client.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  private async remove(key: string): Promise<void> {
    const client = this.redisClientService.getClient();
    if (!client) {
      this.memory.delete(key);
      return;
    }
    await client.del(key);
  }

  private bindingKey(token: string): string {
    return `sts:line-link:binding:${createHash('sha256').update(token).digest('hex')}`;
  }

  private stateKey(state: string): string {
    return `sts:line-link:state:${state}`;
  }
}
