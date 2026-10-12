import type { QueryRunner } from 'typeorm';
import { AllowSeveralGuardiansPerSubmission20261012120000 } from './migrations/20261012120000-AllowSeveralGuardiansPerSubmission';

describe('AllowSeveralGuardiansPerSubmission20261012120000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AllowSeveralGuardiansPerSubmission20261012120000()[direction](runner);
    return statements;
  };

  it('adds the junction with real foreign keys and makes ไม่มีผู้ปกครอง exclusive', async () => {
    const statements = await collectSql('up');
    const sql = statements.join('\n');
    expect(sql).toContain('ADD COLUMN is_exclusive BOOLEAN NOT NULL DEFAULT FALSE');
    expect(sql).toContain("SET is_exclusive = TRUE WHERE code = 'NO_GUARDIAN'");
    const table = statements.find((statement) =>
      statement.startsWith('CREATE TABLE task_submission_guardian_types'),
    );
    expect(table).toContain('REFERENCES task_submissions(id) ON DELETE CASCADE ON UPDATE CASCADE');
    expect(table).toContain(
      'REFERENCES guardian_type_options(code) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(table).toContain('PRIMARY KEY (task_submission_id, guardian_type_code)');
    expect(sql).toContain('CREATE INDEX idx_task_submission_guardian_types_code');
  });

  it('copies every answer before the column goes, splitting บิดาและมารดา in two', async () => {
    const statements = await collectSql('up');
    const copy = statements.findIndex((statement) =>
      statement.startsWith('INSERT INTO task_submission_guardian_types'),
    );
    const drop = statements.findIndex((statement) =>
      statement.includes('DROP COLUMN guardian_type_code'),
    );
    const retire = statements.findIndex((statement) =>
      statement.startsWith('DELETE FROM guardian_type_options'),
    );
    expect(copy).toBeGreaterThan(-1);
    expect(copy).toBeLessThan(drop);
    expect(drop).toBeLessThan(retire);
    expect(statements[copy]).toContain(
      "WHEN 'FATHER_AND_MOTHER' THEN ARRAY['FATHER', 'MOTHER']::varchar[]",
    );
    expect(statements[copy]).toContain('WHERE submission.guardian_type_code IS NOT NULL');
    expect(statements[retire]).toContain("WHERE code = 'FATHER_AND_MOTHER'");
    expect(statements[drop]).toContain(
      'guardian_type_detail IS NULL OR length(btrim(guardian_type_detail)) > 0',
    );
  });

  it('folds the set back into one column on the way down', async () => {
    const statements = await collectSql('down');
    const restoreOption = statements.findIndex((statement) =>
      statement.includes("VALUES ('FATHER_AND_MOTHER', 'บิดาและมารดา', 30, FALSE)"),
    );
    const fold = statements.findIndex((statement) =>
      statement.startsWith('UPDATE task_submissions submission SET guardian_type_code'),
    );
    const dropTable = statements.findIndex((statement) =>
      statement.startsWith('DROP TABLE IF EXISTS task_submission_guardian_types'),
    );
    expect(restoreOption).toBe(1);
    expect(statements[0]).toContain('IN ACCESS EXCLUSIVE MODE');
    expect(statements[0]).toContain('count(*) = 2');
    expect(statements[0]).toContain("bool_and(guardian_type_code IN ('FATHER', 'MOTHER'))");
    expect(statements[0]).toContain(
      'refusing rollback: guardian answers cannot fit the legacy column',
    );
    expect(fold).toBeGreaterThan(restoreOption);
    expect(fold).toBeLessThan(dropTable);
    expect(statements[fold]).toContain("THEN 'FATHER_AND_MOTHER'");
    expect(statements.join('\n')).toContain(
      'guardian_type_code IS NOT NULL AND length(btrim(guardian_type_detail)) > 0',
    );
    expect(statements.at(-1)).toContain('DROP COLUMN IF EXISTS is_exclusive');
  });
});
