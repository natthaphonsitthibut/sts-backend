import type { QueryRunner } from 'typeorm';
import { AddStudentProblemCategories20260825180000 } from './migrations/20260825180000-AddStudentProblemCategories';

describe('AddStudentProblemCategories20260825180000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;

    await new AddStudentProblemCategories20260825180000()[direction](queryRunner);
    return statements.join('\n');
  };

  it('creates independent comment and follow-up category catalogs', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('CREATE TABLE classroom_student_problem_categories');
    expect(sql).toContain('CREATE TABLE follow_up_problem_categories');
    expect(sql).toContain("('HEALTH', 'ปัญหาด้านสุขภาพ', 'เช่น เจ็บป่วย, ได้รับบาดเจ็บ', 10)");
    expect(sql).toContain('REFERENCES classroom_student_problem_categories(code)');
    expect(sql).toContain('REFERENCES follow_up_problem_categories(code)');
  });

  it('preserves comment descriptions and fills every new category', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('RENAME COLUMN comment_text TO problem_description');
    expect(sql).toContain('UPDATE classroom_student_comments SET problem_category_code = CASE');
    expect(sql).toContain("ELSE 'OTHER' END");
    expect(sql).toContain('ALTER COLUMN problem_category_code SET NOT NULL');
    expect(sql).not.toContain('DELETE FROM classroom_student_comments');
  });

  it('clears the retired result and maps legacy FAMILY without deleting submissions', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('UPDATE task_submissions SET follow_up_assessment_code = NULL');
    expect(sql).toContain("ELSE 'OTHER' END WHERE cause_category IS NOT NULL");
    expect(sql).toContain('DROP COLUMN cause_category');
    expect(sql).not.toContain('DELETE FROM task_submissions');
  });

  it('restores former columns while preserving comment descriptions', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('RENAME COLUMN problem_description TO comment_text');
    expect(sql).toContain('DROP TABLE follow_up_problem_categories');
    expect(sql).toContain('DROP TABLE classroom_student_problem_categories');
    expect(sql).not.toContain('DELETE FROM classroom_student_comments');
  });
});
