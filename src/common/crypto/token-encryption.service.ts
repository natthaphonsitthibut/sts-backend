import * as crypto from 'crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { encryptionConfig } from '../../config/encryption.config';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const FORMAT_VERSION = 'v1';

/**
 * AES-256-GCM encrypt/decrypt for secrets that must be redisplayed later
 * (e.g. `task_links.magic_link`'s raw token) — unlike a password or
 * `token_hash`, this is deliberately reversible. Ciphertext is versioned
 * (`v1:<iv>:<tag>:<ciphertext>`, all hex) so the key/algorithm can rotate
 * later without an unreadable mixed-format column.
 */
@Injectable()
export class TokenEncryptionService {
  constructor(
    @Inject(encryptionConfig.KEY)
    private readonly config: ConfigType<typeof encryptionConfig>,
  ) {}

  encrypt(plainText: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.config.taskLinkKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      FORMAT_VERSION,
      iv.toString('hex'),
      tag.toString('hex'),
      ciphertext.toString('hex'),
    ].join(':');
  }

  decrypt(encoded: string): string {
    const parts = encoded.split(':');
    const [version, ivHex, tagHex, ciphertextHex] = parts;
    if (parts.length !== 4 || version !== FORMAT_VERSION) {
      throw new Error(`Unsupported token ciphertext format: ${version ?? 'unknown'}`);
    }
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      this.config.taskLinkKey,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const plainText = Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]);
    return plainText.toString('utf8');
  }
}
