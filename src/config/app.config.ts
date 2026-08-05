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
  /**
   * Express `trust proxy` hop count. 0 = trust none (use the socket IP, correct
   * for direct exposure). Behind a known reverse proxy/LB set the number of
   * trusted hops (usually 1) so rate-limiting sees the real client IP. Never a
   * blanket `true`: that lets clients spoof X-Forwarded-For to dodge throttling.
   */
  trustProxy: number;
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

function parseTrustProxy(value: string | undefined): number {
  const normalized = (value || '').trim().toLowerCase();
  if (normalized === '' || normalized === 'false') {
    return 0;
  }
  // `true` is mapped to a single trusted hop rather than Express's blanket-trust
  // boolean, so X-Forwarded-For cannot be spoofed past one proxy.
  if (normalized === 'true') {
    return 1;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
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
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  };
}

export const appConfig = registerAs('app', () => getAppConfigFromEnv());
