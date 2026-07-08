import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { appConfig } from '../../config/app.config';
import type { FileServeResult, FileStorageAdapter } from './file-storage.types';

// Dev/pilot fallback — writes to the local filesystem. Note this is NOT
// durable on a host with an ephemeral disk (e.g. Render): files are lost on
// redeploy/restart. Use SupabaseStorageAdapter in that kind of environment.
@Injectable()
export class LocalDiskStorageAdapter implements FileStorageAdapter {
  constructor(
    @Inject(appConfig.KEY)
    private readonly runtimeConfig: ConfigType<typeof appConfig>,
  ) {}

  async save(buffer: Buffer, filename: string): Promise<void> {
    const dir = resolve(this.runtimeConfig.uploadsDir);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, filename), buffer);
  }

  // Synchronous under the hood (existsSync) — no await needed, but the shared
  // FileStorageAdapter interface is async so callers can treat every adapter
  // the same regardless of whether a given implementation needs to be.
  resolve(filename: string): Promise<FileServeResult | null> {
    const baseDir = resolve(this.runtimeConfig.uploadsDir);
    const fullPath = resolve(join(baseDir, filename));
    // Belt-and-suspenders: the resolved path must stay inside the uploads dir.
    if (fullPath !== join(baseDir, filename) && !fullPath.startsWith(baseDir + sep)) {
      return Promise.resolve(null);
    }
    if (!existsSync(fullPath)) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ kind: 'local', filePath: fullPath });
  }
}
