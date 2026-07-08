import { Global, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { storageConfig } from '../../config/storage.config';
import { FILE_STORAGE_ADAPTER } from './file-storage.types';
import { LocalDiskStorageAdapter } from './local-disk-storage.adapter';
import { SupabaseStorageAdapter } from './supabase-storage.adapter';

@Global()
@Module({
  providers: [
    LocalDiskStorageAdapter,
    SupabaseStorageAdapter,
    {
      provide: FILE_STORAGE_ADAPTER,
      inject: [storageConfig.KEY, LocalDiskStorageAdapter, SupabaseStorageAdapter],
      useFactory: (
        config: ConfigType<typeof storageConfig>,
        local: LocalDiskStorageAdapter,
        supabase: SupabaseStorageAdapter,
      ) => (config.supabaseUrl && config.supabaseServiceRoleKey ? supabase : local),
    },
  ],
  exports: [FILE_STORAGE_ADAPTER],
})
export class FileStorageModule {}
