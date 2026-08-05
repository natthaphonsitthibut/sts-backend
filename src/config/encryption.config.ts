import { registerAs } from '@nestjs/config';

export interface EncryptionRuntimeConfig {
  /** Raw 32-byte AES-256 key, hex-decoded from TASK_LINK_ENCRYPTION_KEY. */
  taskLinkKey: Buffer;
}

/**
 * Required secret — no fallback on purpose, same posture as JWT_SECRET/
 * AUTH_SESSION_SECRET in auth.config.ts. A missing/weak key means task_links
 * tokens can't be decrypted for redisplay (a hard failure is safer than
 * silently running with a guessable key).
 */
function requireAesKey(value: string | undefined): Buffer {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(
      '[config] TASK_LINK_ENCRYPTION_KEY must be set (64 hex chars = 32 bytes for AES-256).',
    );
  }
  const key = Buffer.from(trimmed, 'hex');
  if (key.length !== 32) {
    throw new Error(
      `[config] TASK_LINK_ENCRYPTION_KEY must decode to exactly 32 bytes, got ${key.length} (expected 64 hex chars).`,
    );
  }
  return key;
}

export function getEncryptionConfigFromEnv(): EncryptionRuntimeConfig {
  return {
    taskLinkKey: requireAesKey(process.env.TASK_LINK_ENCRYPTION_KEY),
  };
}

export const encryptionConfig = registerAs('encryption', () => getEncryptionConfigFromEnv());
