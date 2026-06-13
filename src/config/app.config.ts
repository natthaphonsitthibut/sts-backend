import { join } from 'path';
import { registerAs } from '@nestjs/config';

export interface AppRuntimeConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  uploadsDir: string;
  uploadsPrefix: string;
  frontendBaseUrl?: string;
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function resolveUploadsDir(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return join(process.cwd(), 'uploads');
  }

  return value.startsWith('/') ? value : join(process.cwd(), value);
}

export function getAppConfigFromEnv(): AppRuntimeConfig {
  const uploadsPrefix = process.env.UPLOADS_PREFIX || '/uploads/';
  const frontendBaseUrl = process.env.FRONTEND_BASE_URL?.trim();
  const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    port: parsePort(process.env.PORT, 3000),
    corsOrigins: parseCsv(process.env.CORS_ORIGINS),
    uploadsDir: resolveUploadsDir(process.env.UPLOADS_DIR),
    uploadsPrefix: uploadsPrefix.startsWith('/') ? uploadsPrefix : `/${uploadsPrefix}`,
    frontendBaseUrl: frontendBaseUrl && frontendBaseUrl.length > 0 ? frontendBaseUrl : undefined,
  };
}

export const appConfig = registerAs('app', () => getAppConfigFromEnv());
