import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Readable } from 'stream';
import { storageConfig } from '../../config/storage.config';
import type { FileServeResult, FileStorageAdapter } from './file-storage.types';

interface SignedUrlResponse {
  signedURL?: string;
  signedUrl?: string;
  error?: string;
}

// Talks to the Supabase Storage REST API directly (no @supabase/supabase-js
// dependency — plain fetch is enough for the two calls this needs). Files sit
// in a private bucket; reads go through a short-lived signed URL rather than
// a public one, so access still depends on the caller having already passed
// FilesController's auth/permission guard.
@Injectable()
export class SupabaseStorageAdapter implements FileStorageAdapter {
  readonly kind = 'private-object' as const;
  private readonly logger = new Logger(SupabaseStorageAdapter.name);

  constructor(
    @Inject(storageConfig.KEY)
    private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  async save(buffer: Buffer, filename: string): Promise<void> {
    const response = await fetch(this.objectUrl(filename), {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }),
      // Node's fetch (undici) accepts a Buffer at runtime; the DOM BodyInit
      // typing just doesn't include it, hence the cast.
      body: buffer as unknown as BodyInit,
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Supabase Storage upload failed (${response.status}): ${detail}`);
    }
  }

  async saveStream(source: Readable, filename: string): Promise<void> {
    const request: RequestInit & { duplex: 'half' } = {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' }),
      body: source as unknown as BodyInit,
      duplex: 'half',
    };
    const response = await fetch(this.objectUrl(filename), request);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Supabase Storage upload failed (${response.status}): ${detail}`);
    }
  }

  async resolve(filename: string): Promise<FileServeResult | null> {
    const response = await fetch(this.signUrl(filename), {
      method: 'POST',
      headers: this.authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ expiresIn: this.config.signedUrlTtlSeconds }),
    });
    if (response.status === 404 || response.status === 400) {
      return null;
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error(`Supabase Storage sign failed (${response.status}): ${detail}`);
      throw new Error(`Supabase Storage sign failed (${response.status})`);
    }
    const body = (await response.json()) as SignedUrlResponse;
    const raw = body.signedURL ?? body.signedUrl;
    if (!raw) {
      return null;
    }
    const url = raw.startsWith('http') ? raw : `${this.storageBaseUrl()}${raw}`;
    return { kind: 'redirect', url };
  }

  async open(filename: string): Promise<Readable | null> {
    const response = await fetch(this.objectUrl(filename), {
      method: 'GET',
      headers: this.authHeaders({}),
    });
    if (response.status === 404) return null;
    if (!response.ok || !response.body) {
      throw new Error(`Supabase Storage download failed (${response.status})`);
    }
    return Readable.from(response.body);
  }

  async delete(filename: string): Promise<void> {
    const response = await fetch(this.objectUrl(filename), {
      method: 'DELETE',
      headers: this.authHeaders({}),
    });
    if (response.status === 404) return;
    if (!response.ok) {
      throw new Error(`Supabase Storage delete failed (${response.status})`);
    }
  }

  private storageBaseUrl(): string {
    return `${this.config.supabaseUrl}/storage/v1`;
  }

  private objectUrl(filename: string): string {
    return `${this.storageBaseUrl()}/object/${this.config.supabaseBucket}/${filename}`;
  }

  private signUrl(filename: string): string {
    return `${this.storageBaseUrl()}/object/sign/${this.config.supabaseBucket}/${filename}`;
  }

  private authHeaders(extra: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.supabaseServiceRoleKey}`,
      apikey: this.config.supabaseServiceRoleKey as string,
      ...extra,
    };
  }
}
