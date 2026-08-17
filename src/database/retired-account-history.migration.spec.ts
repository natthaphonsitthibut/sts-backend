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
});
