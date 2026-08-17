import type { QueryRunner } from 'typeorm';
import { AddHomeVisitHouseholdContext20260815170000 } from './migrations/20260815170000-AddHomeVisitHouseholdContext';

describe('AddHomeVisitHouseholdContext20260815170000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new AddHomeVisitHouseholdContext20260815170000()[direction](queryRunner);
    return statements.join('\n');
  };

  it('adds the household catalogs with submission foreign keys', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('CREATE TABLE parental_status_options');
    expect(sql).toContain('CREATE TABLE guardian_type_options');
    expect(sql).toContain('CREATE TABLE residence_environment_options');
    expect(sql).toContain("('BOTH_DECEASED', 'บิดาและมารดาเสียชีวิต', 60)");
    expect(sql).toContain("('OTHER', 'อื่น ๆ (ระบุในช่อง)', 80, TRUE)");
    expect(sql).toContain("('NORMAL', 'ปกติ / ไม่มีปัจจัยเสี่ยง', 10, TRUE, FALSE)");
    expect(sql).toContain('ADD COLUMN parental_status_code VARCHAR(40)');
    expect(sql).toContain('ADD COLUMN guardian_type_code VARCHAR(40)');
    expect(sql).toContain('ADD COLUMN guardian_type_detail VARCHAR(200)');
    expect(sql).toContain('ADD COLUMN residence_environment_detail TEXT');
    expect(sql).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
  });

  it('keeps the observed environments as a many-to-many owned by the submission', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('CREATE TABLE task_submission_residence_environments');
    expect(sql).toContain('REFERENCES task_submissions(id) ON DELETE CASCADE ON UPDATE CASCADE');
    expect(sql).toContain('PRIMARY KEY (task_submission_id, residence_environment_code)');
  });

  it('removes the household relations reversibly', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('DROP TABLE IF EXISTS task_submission_residence_environments');
    expect(sql).toContain('DROP COLUMN IF EXISTS guardian_type_code');
    expect(sql).toContain('DROP TABLE IF EXISTS residence_environment_options');
    expect(sql).toContain('DROP TABLE IF EXISTS guardian_type_options');
    expect(sql).toContain('DROP TABLE IF EXISTS parental_status_options');
  });
});
