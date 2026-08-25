import type { QueryRunner } from 'typeorm';
import { AddClassroomCommentConcernLevels20260827306000 } from './migrations/20260827306000-AddClassroomCommentConcernLevels';

describe('AddClassroomCommentConcernLevels20260827306000', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddClassroomCommentConcernLevels20260827306000()[direction](runner);
    return statements.join('\n');
  };

  it('aligns nine shared categories while keeping independent catalogs', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('INSERT INTO classroom_student_problem_categories');
    expect(sql).toContain('INSERT INTO follow_up_problem_categories');
    expect(sql).toContain("('ATTENDANCE', 'การมาเรียน'");
    expect(sql).toContain("('FAMILY_CARE', 'ครอบครัวและการดูแล'");
    expect(sql).toContain("('SAFETY', 'ความปลอดภัย'");
    expect(sql).toContain('shared core categories are not aligned');
    expect(sql).not.toContain(
      'REFERENCES follow_up_problem_categories(code) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
  });

  it('backfills legacy comments to NOTE and creates the scoped watchlist index', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('CREATE TABLE classroom_student_comment_concern_levels');
    expect(sql).toContain("UPDATE classroom_student_comments SET concern_level_code = 'NOTE'");
    expect(sql).toContain('ALTER COLUMN concern_level_code SET NOT NULL');
    expect(sql).toContain('REFERENCES classroom_student_comment_concern_levels(code)');
    expect(sql).toContain('CREATE INDEX idx_classroom_student_comments_watchlist');
    expect(sql).toContain("WHERE concern_level_code IN ('WATCH', 'CONCERN')");
  });

  it('refuses a lossy rollback and removes only the additive contract', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('teacher comments use WATCH or CONCERN');
    expect(sql).toContain('records use the added shared categories');
    expect(sql).toContain('DROP COLUMN concern_level_code');
    expect(sql).toContain('DROP TABLE classroom_student_comment_concern_levels');
    expect(sql).not.toContain('DELETE FROM classroom_student_comments');
    expect(sql).not.toContain('DELETE FROM task_submissions');
  });
});
