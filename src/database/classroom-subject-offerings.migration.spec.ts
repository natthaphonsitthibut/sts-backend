import type { QueryRunner } from 'typeorm';
import { AddClassroomSubjectOfferings20260827230000 } from './migrations/20260827230000-AddClassroomSubjectOfferings';

describe('AddClassroomSubjectOfferings20260827230000', () => {
  const collectSql = async (direction: 'up' | 'down'): Promise<string> => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((statement: string) => {
        const normalized = statement.replace(/\s+/g, ' ').trim();
        statements.push(normalized);
        if (normalized.includes('invalid_homeroom_count')) {
          return Promise.resolve([{ missing_count: 0, invalid_homeroom_count: 0 }]);
        }
        if (normalized.includes('AS count')) return Promise.resolve([{ count: 0 }]);
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddClassroomSubjectOfferings20260827230000()[direction](runner);
    return statements.join('\n');
  };

  it('creates school and classroom offerings with tenant-safe FKs', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('CREATE TABLE school_subjects');
    expect(sql).toContain('CREATE TABLE classroom_subjects');
    expect(sql).toContain(
      'FOREIGN KEY (school_subject_id, school_id) REFERENCES school_subjects(id, school_id) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(sql).toContain(
      'FOREIGN KEY (classroom_id, school_id) REFERENCES school_classrooms(id, school_id) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(sql).toContain('CREATE UNIQUE INDEX uq_classroom_subjects_live_offering');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('backfills HOMEROOM through the same relation as other subjects', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain("candidate.code IN ('HOMEROOM101', 'HOMEROOM')");
    expect(sql).toContain("ORDER BY (candidate.code = 'HOMEROOM101') DESC, candidate.id");
    expect(sql).toContain('INSERT INTO school_subjects');
    expect(sql).toContain('INSERT INTO classroom_subjects');
    expect(sql).toContain('HAVING COUNT(subject.id) <> 1');
  });

  it('refuses rollback when attendance or target-only offerings consume it', async () => {
    const sql = await collectSql('down');

    expect(sql).toContain('attendance_sessions still consumes classroom_subjects');
    expect(sql).toContain('classroom_subjects contains target-only consumer data');
  });
});
