import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import { RedisClientService } from '../redis/redis-client.service';

/** Short-lived proof that the holder verified a specific teacher identity. */
export interface TeacherLineBindingSession {
  teacherId: string;
  invitationId?: string;
  schoolId?: number;
}

/** One in-flight sign-in: ties the provider's `state` back to a binding session. */
export interface TeacherLineOAuthState {
  bindingToken: string;
  teacherId: string;
  nonce: string;
}

export interface TeacherLineGroupInvitation {
  id: string;
  schoolId: number;
  schoolName: string;
  startsAt: number;
  expiresAt: number;
}

interface TeacherLineGroupInvitationAdminRecord extends TeacherLineGroupInvitation {
  /** Ephemeral capability returned only to authenticated admins for re-sharing. */
  shareTokenEncrypted: string;
  tokenKey: string;
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

  constructor(
    private readonly redisClientService: RedisClientService,
    private readonly tokenEncryption: TokenEncryptionService,
  ) {}

  /** Issued once email OTP or AraID is verified; the raw token goes to the browser only. */
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

  async createGroupInvitation(
    timing: Omit<TeacherLineGroupInvitation, 'id'>,
  ): Promise<{ id: string; token: string } | null> {
    const id = randomUUID();
    const token = randomBytes(32).toString('hex');
    const tokenKey = this.groupInvitationKey(token);
    const invitation: TeacherLineGroupInvitation = { id, ...timing };
    const ttlSeconds = Math.max(1, Math.ceil((invitation.expiresAt - Date.now()) / 1000));
    const adminRecord = {
      ...invitation,
      shareTokenEncrypted: this.tokenEncryption.encrypt(token),
      tokenKey,
    } satisfies TeacherLineGroupInvitationAdminRecord;
    const activeKey = this.groupInvitationActiveKey(invitation.schoolId);
    const client = this.redisClientService.getClient();
    if (client) {
      const result = await client.eval(
        `
          if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
          redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
          redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
          return 1
        `,
        2,
        tokenKey,
        activeKey,
        JSON.stringify(invitation),
        JSON.stringify(adminRecord),
        ttlSeconds,
      );
      if (Number(result) !== 1) return null;
    } else {
      const previous = await this.read<TeacherLineGroupInvitationAdminRecord>(activeKey);
      if (previous) return null;
      this.memory.set(tokenKey, { value: invitation, expiresAt: invitation.expiresAt });
      this.memory.set(activeKey, { value: adminRecord, expiresAt: invitation.expiresAt });
    }
    return { id, token };
  }

  async readGroupInvitation(token: string): Promise<TeacherLineGroupInvitation | null> {
    if (!token) return null;
    return await this.read<TeacherLineGroupInvitation>(this.groupInvitationKey(token));
  }

  async readActiveGroupInvitation(
    schoolId: number,
  ): Promise<(TeacherLineGroupInvitation & { shareToken: string }) | null> {
    const record = await this.read<TeacherLineGroupInvitationAdminRecord>(
      this.groupInvitationActiveKey(schoolId),
    );
    if (!record) return null;
    try {
      return {
        id: record.id,
        schoolId: record.schoolId,
        schoolName: record.schoolName,
        startsAt: record.startsAt,
        expiresAt: record.expiresAt,
        shareToken: this.tokenEncryption.decrypt(record.shareTokenEncrypted),
      };
    } catch {
      return null;
    }
  }

  async updateGroupInvitation(
    id: string,
    schoolId: number,
    timing: Pick<TeacherLineGroupInvitation, 'startsAt' | 'expiresAt'>,
  ): Promise<boolean> {
    const activeKey = this.groupInvitationActiveKey(schoolId);
    const ttlSeconds = Math.max(1, Math.ceil((timing.expiresAt - Date.now()) / 1000));
    const client = this.redisClientService.getClient();
    if (client) {
      const result = await client.eval(
        `
          local raw = redis.call('GET', KEYS[1])
          if not raw then return 0 end
          local value = cjson.decode(raw)
          if value.id ~= ARGV[1] then return 0 end
          value.startsAt = tonumber(ARGV[2])
          value.expiresAt = tonumber(ARGV[3])
          local invitation = {
            id = value.id,
            schoolId = value.schoolId,
            schoolName = value.schoolName,
            startsAt = value.startsAt,
            expiresAt = value.expiresAt
          }
          redis.call('SET', value.tokenKey, cjson.encode(invitation), 'EX', ARGV[4])
          redis.call('SET', KEYS[1], cjson.encode(value), 'EX', ARGV[4])
          return 1
        `,
        1,
        activeKey,
        id,
        timing.startsAt,
        timing.expiresAt,
        ttlSeconds,
      );
      return Number(result) === 1;
    }
    const record = await this.read<TeacherLineGroupInvitationAdminRecord>(activeKey);
    if (!record || record.id !== id) return false;
    const invitation = {
      id,
      schoolId: record.schoolId,
      schoolName: record.schoolName,
      ...timing,
    } satisfies TeacherLineGroupInvitation;
    const updatedRecord = { ...record, ...timing } satisfies TeacherLineGroupInvitationAdminRecord;
    this.memory.set(record.tokenKey, { value: invitation, expiresAt: timing.expiresAt });
    this.memory.set(activeKey, { value: updatedRecord, expiresAt: timing.expiresAt });
    return true;
  }

  async revokeGroupInvitation(id: string, schoolId: number): Promise<boolean> {
    const activeKey = this.groupInvitationActiveKey(schoolId);
    const client = this.redisClientService.getClient();
    if (client) {
      const result = await client.eval(
        `
          local raw = redis.call('GET', KEYS[1])
          if not raw then return 0 end
          local value = cjson.decode(raw)
          if value.id ~= ARGV[1] then return 0 end
          if value.tokenKey then redis.call('DEL', value.tokenKey) end
          redis.call('DEL', KEYS[1])
          return 1
        `,
        1,
        activeKey,
        id,
      );
      return Number(result) === 1;
    }
    const record = await this.read<TeacherLineGroupInvitationAdminRecord>(activeKey);
    if (!record || record.id !== id) return false;
    await this.remove(record.tokenKey);
    await this.remove(activeKey);
    return true;
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

  private groupInvitationKey(token: string): string {
    return `sts:line-link:group:${createHash('sha256').update(token).digest('hex')}`;
  }

  private groupInvitationActiveKey(schoolId: number): string {
    return `sts:line-link:group-active:school:${schoolId}`;
  }
}
