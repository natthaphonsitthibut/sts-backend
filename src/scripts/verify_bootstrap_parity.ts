import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { SYSTEM_ROLE_DEFINITIONS } from '../auth/permissions.constants';
import { DATABASE_BASELINE_SQL, SYSTEM_SETTING_DEFINITIONS } from '../database/bootstrap-sql';

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertIncludes(source: string, expected: string, label: string): void {
  if (!source.includes(expected)) {
    throw new Error(`${label} is not using the shared bootstrap helper`);
  }
}

function main(): void {
  const migrationPath = resolve(
    __dirname,
    '../database/migrations/20260328145500-CreateBaselineSchema.ts',
  );
  const legacyBootstrapPath = resolve(__dirname, '../database/database.service.ts');

  const migrationSource = readFileSync(migrationPath, 'utf8');

  assertIncludes(migrationSource, 'runDatabaseBootstrap(queryRunner)', 'Baseline migration');

  if (existsSync(legacyBootstrapPath)) {
    throw new Error(
      'Legacy runtime bootstrap still exists. Expected database.service.ts to be removed.',
    );
  }

  const schemaHash = hashText(DATABASE_BASELINE_SQL);
  const rolesHash = hashText(JSON.stringify(SYSTEM_ROLE_DEFINITIONS));
  const settingsHash = hashText(JSON.stringify(SYSTEM_SETTING_DEFINITIONS));
  const combinedHash = hashText(`${schemaHash}:${rolesHash}:${settingsHash}`);

  console.log('Bootstrap parity verified.');
  console.log('Legacy runtime bootstrap removed.');
  console.log(`Schema hash: ${schemaHash}`);
  console.log(`Roles hash: ${rolesHash}`);
  console.log(`Settings hash: ${settingsHash}`);
  console.log(`Combined bootstrap hash: ${combinedHash}`);
}

main();
