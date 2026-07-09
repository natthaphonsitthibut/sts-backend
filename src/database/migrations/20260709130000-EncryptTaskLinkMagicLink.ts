import type { MigrationInterface, QueryRunner } from 'typeorm';
import { TokenEncryptionService } from '../../common/crypto/token-encryption.service';
import { getEncryptionConfigFromEnv } from '../../config/encryption.config';

/**
 * Expand step of the task_links.magic_link plaintext fix (see
 * tasks/task-magic-link-plaintext-token.md). Adds `token_encrypted` and
 * backfill-encrypts every existing row's raw token (extracted from the
 * `magic_link` URL's last path segment) so the app can switch reads/writes
 * over to it. `magic_link` itself is left untouched here — dropping it is a
 * separate follow-up migration once the switch is verified in production.
 */
export class EncryptTaskLinkMagicLink20260709130000 implements MigrationInterface {
  name = 'EncryptTaskLinkMagicLink20260709130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links ADD COLUMN IF NOT EXISTS token_encrypted TEXT NULL
    `);

    const tokenEncryption = new TokenEncryptionService(getEncryptionConfigFromEnv());
    const rows = (await queryRunner.query(`
      SELECT id, magic_link FROM task_links
      WHERE magic_link IS NOT NULL AND token_encrypted IS NULL
    `)) as Array<{ id: string; magic_link: string | null }>;

    for (const row of rows) {
      const token = row.magic_link?.split('/').pop()?.trim();
      if (!token) continue;
      const tokenEncrypted = tokenEncryption.encrypt(token);
      await queryRunner.query(`UPDATE task_links SET token_encrypted = $1 WHERE id = $2`, [
        tokenEncrypted,
        row.id,
      ]);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE task_links DROP COLUMN IF EXISTS token_encrypted`);
  }
}
