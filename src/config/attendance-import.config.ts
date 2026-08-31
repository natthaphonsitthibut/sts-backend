import { registerAs } from '@nestjs/config';

export interface AttendanceImportRuntimeConfig {
  /**
   * Hosts the server may fetch an attendance sheet from. A leading `*.` matches
   * sub-domains only (`*.sharepoint.com` accepts `contoso.sharepoint.com` but
   * not `sharepoint.com`). Keeping this an allowlist — rather than "any https
   * URL minus private ranges" — is the primary SSRF control: the server never
   * issues a request to a host the operator has not approved.
   */
  allowedUrlHosts: string[];
  maxFileBytes: number;
  maxRows: number;
  fetchTimeoutMs: number;
  maxRedirects: number;
}

/**
 * Fixed on purpose: multer must apply the same ceiling from a decorator that is
 * evaluated at import time, before `.env` is loaded, so an env-driven value here
 * would silently disagree with the HTTP-layer limit.
 */
export const ATTENDANCE_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

const DEFAULT_ALLOWED_URL_HOSTS = [
  'docs.google.com',
  'drive.google.com',
  'drive.usercontent.google.com',
  'onedrive.live.com',
  '1drv.ms',
  '*.sharepoint.com',
];

const DEFAULT_MAX_ROWS = 2000;
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;

function parseHosts(value: string | undefined): string[] {
  if (!value || value.trim().length === 0) {
    return [...DEFAULT_ALLOWED_URL_HOSTS];
  }

  return value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((value || '').trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAttendanceImportConfigFromEnv(): AttendanceImportRuntimeConfig {
  return {
    allowedUrlHosts: parseHosts(process.env.ATTENDANCE_IMPORT_ALLOWED_HOSTS),
    maxFileBytes: ATTENDANCE_IMPORT_MAX_FILE_BYTES,
    maxRows: parsePositiveInteger(process.env.ATTENDANCE_IMPORT_MAX_ROWS, DEFAULT_MAX_ROWS),
    fetchTimeoutMs: parsePositiveInteger(
      process.env.ATTENDANCE_IMPORT_FETCH_TIMEOUT_MS,
      DEFAULT_FETCH_TIMEOUT_MS,
    ),
    maxRedirects: parsePositiveInteger(
      process.env.ATTENDANCE_IMPORT_MAX_REDIRECTS,
      DEFAULT_MAX_REDIRECTS,
    ),
  };
}

export const attendanceImportConfig = registerAs('attendanceImport', () =>
  getAttendanceImportConfigFromEnv(),
);
