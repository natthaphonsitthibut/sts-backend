import { registerAs } from '@nestjs/config';

export interface EmailRuntimeConfig {
  enabled: boolean;
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
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
  return {
    enabled: parseBoolean(process.env.EMAIL_ENABLED),
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parsePort(process.env.EMAIL_PORT, 587),
    user: process.env.EMAIL_USER || '',
    pass: process.env.EMAIL_PASS || '',
    from: process.env.EMAIL_FROM || '"STS System" <noreply@sts-app.com>',
  };
}

export const emailConfig = registerAs('email', () => getEmailConfigFromEnv());
