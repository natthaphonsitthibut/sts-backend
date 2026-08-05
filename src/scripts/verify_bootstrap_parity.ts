import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { SYSTEM_ROLE_DEFINITIONS } from '../auth/permissions.constants';
import { DATABASE_BASELINE_SQL, SYSTEM_SETTING_DEFINITIONS } from '../database/bootstrap-sql';

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertIncludes(source: string, expected: string, message: string): void {
  if (!source.includes(expected)) {
    throw new Error(message);
  }
}

function assertExcludes(source: string, banned: string, message: string): void {
  if (source.includes(banned)) {
    throw new Error(message);
  }
}

function main(): void {
  const migrationPath = resolve(
    __dirname,
    '../database/migrations/20260328145500-CreateBaselineSchema.ts',
  );
  const frozenBaselinePath = resolve(__dirname, '../database/migration-baseline-202603.ts');
  const legacyBootstrapPath = resolve(__dirname, '../database/database.service.ts');

  const migrationSource = readFileSync(migrationPath, 'utf8');
  const frozenBaselineSource = readFileSync(frozenBaselinePath, 'utf8');

  // The first migration must replay the frozen 2026-03 snapshot forever; the
  // live bootstrap catalog keeps moving with HEAD and would corrupt fresh
  // installs if the historical migration ever pointed back at it.
  assertIncludes(
    migrationSource,
    'MIGRATION_BASELINE_202603_SQL',
    'Baseline migration is not using the frozen 2026-03 schema snapshot',
  );
  assertExcludes(
    migrationSource,
    'bootstrap-sql',
    'Baseline migration must not depend on the live bootstrap catalog',
  );
  if (/^import\s/m.test(frozenBaselineSource)) {
    throw new Error('Frozen baseline snapshot must stay self-contained (no imports)');
  }

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
