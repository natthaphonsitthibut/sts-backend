import { registerAs } from '@nestjs/config';

export interface DatabaseRuntimeConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  ssl: boolean;
}

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseBoolean(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value || '').trim().toLowerCase());
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function getDatabaseConfigFromEnv(): DatabaseRuntimeConfig {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parsePort(process.env.DB_PORT, 5432),
    username: process.env.DB_USER || 'postgres',
    password: requireEnv('DB_PASSWORD'),
    database: process.env.DB_NAME || 'sts',
    ssl: parseBoolean(process.env.DB_SSL),
  };
}

export const databaseConfig = registerAs('database', () => getDatabaseConfigFromEnv());
