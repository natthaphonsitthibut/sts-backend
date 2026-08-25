import type { QueryRunner } from 'typeorm';
import { AllowTeacherPiiAccessSubjects20260827312300 } from './migrations/20260827312300-AllowTeacherPiiAccessSubjects';

describe('AllowTeacherPiiAccessSubjects20260827312300', () => {
  const collectSql = async (direction: 'up' | 'down') => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        statements.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AllowTeacherPiiAccessSubjects20260827312300()[direction](runner);
    return statements.join('\n');
  };

  it('extends and validates the immutable audit subject constraint', async () => {
    const sql = await collectSql('up');
    expect(sql).toContain("subject_type IN ('STUDENT', 'USER', 'TEACHER')");
    expect(sql).toContain('VALIDATE CONSTRAINT chk_pii_access_events_subject_type');
  });

  it('refuses a lossy rollback once teacher audit rows exist', async () => {
    const sql = await collectSql('down');
    expect(sql).toContain("subject_type = 'TEACHER'");
    expect(sql).toContain('Cannot remove TEACHER PII subject support');
    expect(sql).toContain("subject_type IN ('STUDENT', 'USER')");
  });
});
