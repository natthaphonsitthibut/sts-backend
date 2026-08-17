import { registerAs } from '@nestjs/config';

export type AraIdMode = 'mock';

export interface AraIdRuntimeConfig {
  mode: AraIdMode;
}

export function getAraIdConfigFromEnv(): AraIdRuntimeConfig {
  const mode = (process.env.ARAID_MODE || 'mock').trim().toLowerCase();
  if (mode !== 'mock') {
    throw new Error(`ARAID_MODE must be "mock" until the real ThaID provider is integrated`);
  }
  return { mode };
}

export const araIdConfig = registerAs('araid', () => getAraIdConfigFromEnv());
