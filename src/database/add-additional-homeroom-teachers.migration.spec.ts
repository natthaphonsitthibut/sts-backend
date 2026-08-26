import type { QueryRunner } from 'typeorm';
import { AddAdditionalHomeroomTeachers20260827313600 } from './migrations/20260827313600-AddAdditionalHomeroomTeachers';

describe('AddAdditionalHomeroomTeachers20260827313600', () => {
  const collectSql = async (direction: 'up' | 'down'): Promise<string> => {
    const statements: string[] = [];
    const runner = {
      query: jest.fn((statement: string) => {
        statements.push(statement.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    } as unknown as QueryRunner;
    await new AddAdditionalHomeroomTeachers20260827313600()[direction](runner);
    return statements.join('\n');
  };

  it('adds a scoped many-teacher relation and a primary-aware union view', async () => {
    const sql = await collectSql('up');

    expect(sql).toContain('CREATE TABLE classroom_additional_homeroom_teachers');
    expect(sql).toContain('PRIMARY KEY (classroom_id)');
    expect(sql).toContain(
      'FOREIGN KEY (classroom_id, school_id) REFERENCES school_classrooms(id, school_id) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(sql).toContain(
      'FOREIGN KEY (teacher_membership_id, school_id) REFERENCES school_teacher_memberships(id, school_id) ON DELETE RESTRICT ON UPDATE CASCADE',
    );
    expect(sql).toContain('CREATE INDEX idx_classroom_additional_homeroom_teachers_membership');
    expect(sql).toContain('CREATE OR REPLACE VIEW classroom_homeroom_teacher_assignments');
    expect(sql).toContain('TRUE AS is_primary');
    expect(sql).toContain('FALSE AS is_primary');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('prevents primary/additional duplicates and refuses a lossy rollback', async () => {
    const upSql = await collectSql('up');
    const downSql = await collectSql('down');

    expect(upSql).toContain('prevent_duplicate_additional_homeroom_teacher');
    expect(upSql).toContain('A primary homeroom teacher is required before an additional teacher');
    expect(upSql).toContain('remove_promoted_additional_homeroom_teacher');
    expect(upSql).toContain('promote_additional_homeroom_teacher_after_primary_delete');
    expect(upSql).toContain("USING ERRCODE = '23505'");
    expect(downSql).toContain(
      'Refusing rollback: additional homeroom teacher assignments must be removed explicitly first',
    );
    expect(downSql).toContain('DROP VIEW classroom_homeroom_teacher_assignments');
  });
});
