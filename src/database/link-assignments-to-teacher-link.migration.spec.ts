import { LinkAssignmentsToTeacherLink20260830150000 } from './migrations/20260830150000-LinkAssignmentsToTeacherLink';

describe('LinkAssignmentsToTeacherLink20260830150000', () => {
  it('adds a scoped parent FK, backfills it, and has a structural rollback', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve([]);
      }),
    };
    const migration = new LinkAssignmentsToTeacherLink20260830150000();

    await migration.up(runner as never);
    const upSql = queries.join('\n');
    expect(upSql).toContain('source_teacher_link_id UUID');
    expect(upSql).toContain('FOREIGN KEY (source_teacher_link_id, school_id, school_term_id)');
    expect(upSql).toContain('ON DELETE RESTRICT ON UPDATE CASCADE');
    expect(upSql).toContain('SET source_teacher_link_id');
    expect(upSql).toContain('idx_classroom_attendance_links_source_teacher_link');

    queries.length = 0;
    await migration.down(runner as never);
    const downSql = queries.join('\n');
    expect(downSql).toContain('DROP CONSTRAINT fk_classroom_attendance_links_source_teacher_link');
    expect(downSql).toContain('DROP COLUMN source_teacher_link_id');
  });
});
