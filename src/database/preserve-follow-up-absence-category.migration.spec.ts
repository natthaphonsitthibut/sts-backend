import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('PreserveFollowUpAbsenceCategory migration', () => {
  const source = readFileSync(
    join(
      process.cwd(),
      'src/database/migrations/20260827313300-PreserveFollowUpAbsenceCategory.ts',
    ),
    'utf8',
  );

  it('backfills the real catalog category and protects it with a foreign key', () => {
    expect(source).toContain('SET absence_reason_category_code = reason.category_code');
    expect(source).toContain('REFERENCES absence_reason_categories(code)');
    expect(source).toContain('ON UPDATE CASCADE ON DELETE RESTRICT');
  });

  it('has a reversible schema down migration', () => {
    expect(source).toContain(
      'DROP CONSTRAINT IF EXISTS fk_task_submissions_absence_reason_category',
    );
    expect(source).toContain('DROP COLUMN IF EXISTS absence_reason_category_code');
  });
});
