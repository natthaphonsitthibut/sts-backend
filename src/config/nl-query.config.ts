import { registerAs } from '@nestjs/config';

export interface NlQueryConfig {
  url: string;
  apiKey: string;
  timeoutMs: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getNlQueryConfigFromEnv(): NlQueryConfig {
  return {
    url: process.env.TEXT_TO_SQL_URL?.trim().replace(/\/+$/, '') || '',
    apiKey: process.env.TEXT_TO_SQL_API_KEY?.trim() || '',
    timeoutMs: parsePositiveInt(process.env.TEXT_TO_SQL_TIMEOUT_MS, 60_000),
  };
}

export const nlQueryConfig = registerAs('nlQuery', () => getNlQueryConfigFromEnv());
