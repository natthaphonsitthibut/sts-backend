import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function readMigration(fileName: string): string {
  return readFileSync(resolve(process.cwd(), 'src', 'database', 'migrations', fileName), 'utf8');
}

describe('retired account migration history safety', () => {
  it('keeps the named owner account as ADMIN with every registered page', () => {
    const source = readMigration('20260821090000-CollapsePermissionsToPages.ts');

    expect(source).toContain("SET role = 'ADMIN'");
    expect(source).toContain('SELECT jsonb_agg(id ORDER BY id) FROM permission_page_catalog');
    expect(source).toContain("WHERE username = 'newnew'");
    expect(source).not.toContain("DELETE FROM users\n      WHERE role = 'STUDENT'");
  });

  it('indexes attendance actor FKs before deleting retired student accounts', () => {
    const migration = readMigration('20260821180000-RemoveRetiredStudentAccounts.ts');
    const bootstrap = readFileSync(
      resolve(process.cwd(), 'src', 'database', 'bootstrap-sql.ts'),
      'utf8',
    );
    const deletePosition = migration.indexOf("DELETE FROM users WHERE role = 'STUDENT'");

    for (const indexName of [
      'idx_attendance_created_by_user_id',
      'idx_attendance_updated_by_user_id',
    ]) {
      expect(migration.indexOf(`CREATE INDEX IF NOT EXISTS ${indexName}`)).toBeGreaterThan(-1);
      expect(migration.indexOf(`CREATE INDEX IF NOT EXISTS ${indexName}`)).toBeLessThan(
        deletePosition,
      );
      expect(migration).toContain(`DROP INDEX IF EXISTS ${indexName}`);
      expect(bootstrap).toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`);
    }
  });

  it.each([
    '20260821180000-RemoveRetiredStudentAccounts.ts',
    '20260823120000-RemoveTeacherUserAccounts.ts',
  ])('%s keeps audit and PII event rows while removing login accounts', (fileName) => {
    const source = readMigration(fileName);

    expect(source).not.toContain('WHERE actor_user_id IN (SELECT id FROM users WHERE role');
    expect(source).toContain('DISABLE TRIGGER');
    expect(source).toContain('ENABLE TRIGGER');
    expect(source).toContain("DELETE FROM users WHERE role = '");
  });

  it('snapshots legacy teacher observation authors instead of deleting their observations', () => {
    const source = readMigration('20260823120000-RemoveTeacherUserAccounts.ts');

    expect(source).toContain('SET observer_display_name = COALESCE');
    expect(source).toContain('ADD COLUMN changed_by_display_name VARCHAR(200)');
    expect(source).not.toMatch(
      /public async up[\s\S]*DELETE FROM student_observations[\s\S]*public async down/,
    );
  });

  it('creates temporary user-FK indexes before auditing teacher delete blockers', () => {
    const source = readMigration('20260823120000-RemoveTeacherUserAccounts.ts');

    expect(source.indexOf('CREATE INDEX "${index.name}"')).toBeLessThan(
      source.indexOf('const blockingForeignKeys'),
    );
    expect(source.indexOf('const blockingForeignKeys')).toBeLessThan(
      source.indexOf("DELETE FROM users WHERE role = 'TEACHER'"),
    );
  });

  it('backfills attendance teacher identity in indexed bounded batches', () => {
    const source = readMigration('20260823090000-PointTeacherIdentityAtTeachers.ts');
    const temporaryIndex = 'tmp_20260823_attendance_recorded_by_backfill';

    expect(source).toContain(`CREATE INDEX ${temporaryIndex}`);
    expect(source).toContain('LIMIT 20000');
    expect(source).toContain('do {');
    expect(source).toContain(`DROP INDEX ${temporaryIndex}`);
    expect(source.indexOf(`CREATE INDEX ${temporaryIndex}`)).toBeLessThan(
      source.indexOf('WITH candidates AS'),
    );
    expect(source.indexOf('WITH candidates AS')).toBeLessThan(
      source.indexOf(`DROP INDEX ${temporaryIndex}`),
    );
  });
});
