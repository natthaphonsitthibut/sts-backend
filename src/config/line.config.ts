import { registerAs } from '@nestjs/config';

/**
 * LINE integration for teacher account linking and for delivering attendance
 * links over the school's Official Account.
 *
 * Read at runtime through ConfigService, never at import time — a static
 * `process.env` read would run before ConfigModule loads the .env file.
 */
export interface LineRuntimeConfig {
  enabled: boolean;
  loginChannelId: string;
  loginChannelSecret: string;
  loginCallbackUrl: string;
  messagingChannelId: string;
  messagingChannelSecret: string;
  messagingChannelAccessToken: string;
  officialAccountBasicId: string;
  requestTimeoutMs: number;
  invitationTtlHours: number;
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function parseTimeout(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getLineConfigFromEnv(): LineRuntimeConfig {
  return {
    enabled: parseBoolean(process.env.LINE_ENABLED),
    loginChannelId: process.env.LINE_LOGIN_CHANNEL_ID || '',
    loginChannelSecret: process.env.LINE_LOGIN_CHANNEL_SECRET || '',
    loginCallbackUrl: process.env.LINE_LOGIN_CALLBACK_URL || '',
    messagingChannelId: process.env.LINE_MESSAGING_CHANNEL_ID || '',
    messagingChannelSecret: process.env.LINE_MESSAGING_CHANNEL_SECRET || '',
    messagingChannelAccessToken: process.env.LINE_MESSAGING_CHANNEL_ACCESS_TOKEN || '',
    officialAccountBasicId: process.env.LINE_OA_BASIC_ID || '',
    requestTimeoutMs: parseTimeout(process.env.LINE_REQUEST_TIMEOUT_MS, 8000),
    invitationTtlHours: parseTimeout(process.env.LINE_INVITATION_TTL_HOURS, 24),
  };
}

/**
 * Which required values are missing. Turning the feature on without them would
 * fail later at the first API call, in a redirect the teacher is standing in
 * front of — so the module refuses to arm itself instead and logs this list.
 */
export function missingLineConfigKeys(config: LineRuntimeConfig): string[] {
  const required: Array<[keyof LineRuntimeConfig, string]> = [
    ['loginChannelId', 'LINE_LOGIN_CHANNEL_ID'],
    ['loginChannelSecret', 'LINE_LOGIN_CHANNEL_SECRET'],
    ['loginCallbackUrl', 'LINE_LOGIN_CALLBACK_URL'],
    ['messagingChannelSecret', 'LINE_MESSAGING_CHANNEL_SECRET'],
    ['messagingChannelAccessToken', 'LINE_MESSAGING_CHANNEL_ACCESS_TOKEN'],
    ['officialAccountBasicId', 'LINE_OA_BASIC_ID'],
  ];
  return required.filter(([key]) => !String(config[key]).trim()).map(([, envName]) => envName);
}

export const lineConfig = registerAs('line', () => getLineConfigFromEnv());
