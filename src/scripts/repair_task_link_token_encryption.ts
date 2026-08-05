import 'reflect-metadata';
import appDataSource from '../database/typeorm.datasource';
import { TokenEncryptionService } from '../common/crypto/token-encryption.service';
import { getEncryptionConfigFromEnv } from '../config/encryption.config';

interface TaskLinkTokenRow {
  id: string;
  magic_link: string | null;
  token_encrypted: string | null;
}

function extractToken(magicLink: string | null): string | null {
  const trimmed = magicLink?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed, 'http://local.invalid');
    const token = url.pathname.split('/').filter(Boolean).pop()?.trim();
    return token || null;
  } catch {
    const token = trimmed.split(/[?#]/, 1)[0]?.split('/').pop()?.trim();
    return token || null;
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to repair task link token encryption with NODE_ENV=production');
  }

  const dryRun = process.argv.includes('--dry-run');
  const tokenEncryption = new TokenEncryptionService(getEncryptionConfigFromEnv());

  await appDataSource.initialize();
  const queryRunner = appDataSource.createQueryRunner();

  const summary = {
    scanned: 0,
    valid: 0,
    invalid: 0,
    repairedInvalid: 0,
    backfilledMissing: 0,
    clearedUnreadable: 0,
    skippedNoSource: 0,
  };

  try {
    const rows = (await queryRunner.query(`
      SELECT id, magic_link, token_encrypted
      FROM task_links
      WHERE deleted_at IS NULL
        AND (token_encrypted IS NOT NULL OR magic_link IS NOT NULL)
      ORDER BY id
    `)) as TaskLinkTokenRow[];

    await queryRunner.startTransaction();

    for (const row of rows) {
      summary.scanned += 1;

      if (row.token_encrypted) {
        try {
          tokenEncryption.decrypt(row.token_encrypted);
          summary.valid += 1;
          continue;
        } catch {
          summary.invalid += 1;
        }
      }

      const token = extractToken(row.magic_link);
      if (token) {
        const repaired = tokenEncryption.encrypt(token);
        if (!dryRun) {
          await queryRunner.query(`UPDATE task_links SET token_encrypted = $1 WHERE id = $2`, [
            repaired,
            row.id,
          ]);
        }
        if (row.token_encrypted) {
          summary.repairedInvalid += 1;
        } else {
          summary.backfilledMissing += 1;
        }
        continue;
      }

      if (row.token_encrypted) {
        if (!dryRun) {
          await queryRunner.query(`UPDATE task_links SET token_encrypted = NULL WHERE id = $1`, [
            row.id,
          ]);
        }
        summary.clearedUnreadable += 1;
      } else {
        summary.skippedNoSource += 1;
      }
    }

    if (dryRun) {
      await queryRunner.rollbackTransaction();
    } else {
      await queryRunner.commitTransaction();
    }

    console.log(
      [
        `task link token encryption repair ${dryRun ? 'dry-run' : 'completed'}`,
        `scanned=${summary.scanned}`,
        `valid=${summary.valid}`,
        `invalid=${summary.invalid}`,
        `repairedInvalid=${summary.repairedInvalid}`,
        `backfilledMissing=${summary.backfilledMissing}`,
        `clearedUnreadable=${summary.clearedUnreadable}`,
        `skippedNoSource=${summary.skippedNoSource}`,
      ].join(' '),
    );
  } catch (error) {
    if (queryRunner.isTransactionActive) {
      await queryRunner.rollbackTransaction();
    }
    throw error;
  } finally {
    await queryRunner.release();
    await appDataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
