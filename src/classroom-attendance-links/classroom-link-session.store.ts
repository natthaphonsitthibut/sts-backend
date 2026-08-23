import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { authConfig } from '../config/auth.config';
import { RedisClientService } from '../redis/redis-client.service';
import type { ClassroomLinkSession } from './classroom-attendance-links.types';

@Injectable()
export class ClassroomLinkSessionStore {
  constructor(
    private readonly redis: RedisClientService,
    @Inject(authConfig.KEY) private readonly config: ConfigType<typeof authConfig>,
  ) {}

  async issue(payload: Omit<ClassroomLinkSession, 'issuedAt'>): Promise<string> {
    const session: ClassroomLinkSession = { ...payload, issuedAt: Date.now() };
    const client = this.redis.getClient();
    if (!client) return this.signFallback(session);
    const token = `cls_${randomBytes(32).toString('base64url')}`;
    await client.set(
      this.key(token),
      JSON.stringify(session),
      'EX',
      this.config.magicSessionTtlSeconds,
    );
    return token;
  }

  async read(token?: string): Promise<ClassroomLinkSession | null> {
    if (!token) return null;
    const client = this.redis.getClient();
    if (!client) return this.readFallback(token);
    try {
      const raw = await client.get(this.key(token));
      if (!raw) return null;
      const session = JSON.parse(raw) as ClassroomLinkSession;
      return this.isFresh(session.issuedAt) ? session : null;
    } catch {
      return null;
    }
  }

  private signFallback(session: ClassroomLinkSession): string {
    const encoded = Buffer.from(JSON.stringify(session)).toString('base64url');
    const signature = createHmac('sha256', this.config.sessionSecret).update(encoded).digest('hex');
    return `${encoded}.${signature}`;
  }

  private readFallback(token: string): ClassroomLinkSession | null {
    try {
      const parts = token.split('.');
      if (parts.length !== 2 || !/^[0-9a-f]{64}$/.test(parts[1])) return null;
      const [encoded, signature] = parts;
      const expected = createHmac('sha256', this.config.sessionSecret).update(encoded).digest();
      const received = Buffer.from(signature, 'hex');
      if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
      const session = JSON.parse(
        Buffer.from(encoded, 'base64url').toString(),
      ) as ClassroomLinkSession;
      return this.isFresh(session.issuedAt) ? session : null;
    } catch {
      return null;
    }
  }

  private isFresh(issuedAt: number): boolean {
    const age = Date.now() - issuedAt;
    return (
      Number.isFinite(issuedAt) &&
      issuedAt > 0 &&
      age >= 0 &&
      age <= this.config.magicSessionTtlSeconds * 1000
    );
  }

  private key(token: string): string {
    return `sts:classroom-link-session:${createHash('sha256').update(token).digest('hex')}`;
  }
}
