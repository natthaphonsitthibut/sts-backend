import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { existsSync } from 'fs';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { dirname, resolve, sep } from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { appConfig } from '../../config/app.config';
import type { FileServeResult, FileStorageAdapter } from './file-storage.types';

// Dev/pilot fallback — writes to the local filesystem. Note this is NOT
// durable on a host with an ephemeral disk (e.g. Render): files are lost on
// redeploy/restart. Use SupabaseStorageAdapter in that kind of environment.
@Injectable()
export class LocalDiskStorageAdapter implements FileStorageAdapter {
  readonly kind = 'local' as const;

  constructor(
    @Inject(appConfig.KEY)
    private readonly runtimeConfig: ConfigType<typeof appConfig>,
  ) {}

  async save(buffer: Buffer, filename: string): Promise<void> {
    const filePath = this.safePath(filename);
    if (!filePath) throw new Error('Invalid storage filename');
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
  }

  async saveStream(source: Readable, filename: string): Promise<void> {
    const filePath = this.safePath(filename);
    if (!filePath) throw new Error('Invalid storage filename');
    await mkdir(dirname(filePath), { recursive: true });
    await pipeline(source, createWriteStream(filePath));
  }

  // Synchronous under the hood (existsSync) — no await needed, but the shared
  // FileStorageAdapter interface is async so callers can treat every adapter
  // the same regardless of whether a given implementation needs to be.
  resolve(filename: string): Promise<FileServeResult | null> {
    const fullPath = this.safePath(filename);
    if (!fullPath) return Promise.resolve(null);
    if (!existsSync(fullPath)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ kind: 'local', filePath: fullPath });
  }

  open(filename: string): Promise<Readable | null> {
    const fullPath = this.safePath(filename);
    if (!fullPath || !existsSync(fullPath)) return Promise.resolve(null);
    return Promise.resolve(createReadStream(fullPath));
  }

  async delete(filename: string): Promise<void> {
    const fullPath = this.safePath(filename);
    if (!fullPath) throw new Error('Invalid storage filename');
    await unlink(fullPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    });
  }

  private safePath(filename: string): string | null {
    if (
      filename.length === 0 ||
      filename.startsWith('/') ||
      filename.includes('\\') ||
      filename.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      return null;
    }
    const baseDir = resolve(this.runtimeConfig.uploadsDir);
    const fullPath = resolve(baseDir, filename);
    return fullPath.startsWith(baseDir + sep) ? fullPath : null;
  }
}
