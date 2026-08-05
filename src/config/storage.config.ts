import { registerAs } from '@nestjs/config';

export interface StorageRuntimeConfig {
  supabaseUrl?: string;
  supabaseServiceRoleKey?: string;
  supabaseBucket: string;
  signedUrlTtlSeconds: number;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getStorageConfigFromEnv(): StorageRuntimeConfig {
  return {
    supabaseUrl: clean(process.env.SUPABASE_URL),
    supabaseServiceRoleKey: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    supabaseBucket: clean(process.env.SUPABASE_STORAGE_BUCKET) ?? 'uploads',
    signedUrlTtlSeconds: parsePositiveInt(process.env.SUPABASE_SIGNED_URL_TTL_SECONDS, 60),
  };
}

export const storageConfig = registerAs('storage', () => getStorageConfigFromEnv());
