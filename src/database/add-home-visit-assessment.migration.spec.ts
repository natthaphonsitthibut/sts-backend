import type { QueryRunner } from 'typeorm';
import { AddHomeVisitAssessment20260731170000 } from './migrations/20260731170000-AddHomeVisitAssessment';

describe('AddHomeVisitAssessment20260731170000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new AddHomeVisitAssessment20260731170000()[direction](queryRunner);
    return statements.join('\n');
  };

  it('adds review-oriented home-visit assessments with a submission foreign key', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('CREATE TABLE home_visit_assessment_options');
    expect(sql).toContain("('NO_CONCERN', 'ไม่พบปัญหาเพิ่มเติม', 10)");
    expect(sql).toContain("('CONTINUE_FOLLOW_UP', 'ควรติดตามต่อ', 20)");
    expect(sql).toContain('ADD COLUMN follow_up_assessment_code VARCHAR(40)');
    expect(sql).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
  });

  it('removes the assessment relation reversibly', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('DROP COLUMN IF EXISTS follow_up_assessment_code');
    expect(sql).toContain('DROP TABLE IF EXISTS home_visit_assessment_options');
  });
});
