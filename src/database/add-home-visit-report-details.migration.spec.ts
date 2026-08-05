import type { QueryRunner } from 'typeorm';
import { AddHomeVisitReportDetails20260731140000 } from './migrations/20260731140000-AddHomeVisitReportDetails';

describe('AddHomeVisitReportDetails20260731140000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new AddHomeVisitReportDetails20260731140000()[direction](queryRunner);
    return statements.join('\n');
  };

  it('adds structured visit details with a restricted exception foreign key', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('CREATE TABLE home_visit_exception_options');
    expect(sql).toContain("('ADDRESS_CHANGED', 'เปลี่ยนที่อยู่', TRUE, 10)");
    expect(sql).toContain("('STUDENT_NOT_FOUND', 'ไม่พบนักเรียน', FALSE, 20)");
    expect(sql).toContain('ADD COLUMN visited_at TIMESTAMPTZ');
    expect(sql).toContain(
      'FOREIGN KEY (home_visit_exception_code) REFERENCES home_visit_exception_options(code) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(sql).toContain("updated_postal_code ~ '^[0-9]{5}$'");
    expect(sql).toContain("home_visit_exception_code <> 'ADDRESS_CHANGED'");
  });

  it('removes constraints and columns before dropping the catalog', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('DROP CONSTRAINT IF EXISTS fk_task_submissions_home_visit_exception');
    expect(sql).toContain('DROP COLUMN IF EXISTS home_visit_exception_code');
    expect(sql).toContain('DROP TABLE IF EXISTS home_visit_exception_options');
  });
});
