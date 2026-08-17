import { registerAs } from '@nestjs/config';

export interface EmailRuntimeConfig {
  enabled: boolean;
  logSimulatedOtp: boolean;
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthRefreshToken: string;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

export function getEmailConfigFromEnv(): EmailRuntimeConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development').trim().toLowerCase();
  const enabled = parseBoolean(process.env.EMAIL_ENABLED);
  return {
    enabled,
    logSimulatedOtp: nodeEnv === 'development' && !enabled,
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parsePort(process.env.EMAIL_PORT, 587),
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || '"STS System" <noreply@sts-app.com>',
    oauthClientId: process.env.GMAIL_OAUTH_CLIENT_ID || '',
    oauthClientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET || '',
    oauthRefreshToken: process.env.GMAIL_OAUTH_REFRESH_TOKEN || '',
  };
}

export const emailConfig = registerAs('email', () => getEmailConfigFromEnv());
