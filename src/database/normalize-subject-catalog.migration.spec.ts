import { NormalizeSubjectCatalog20260827260000 } from './migrations/20260827260000-NormalizeSubjectCatalog';

describe('NormalizeSubjectCatalog20260827260000', () => {
  it('guards collisions, rewrites every production FK consumer, and removes duplicates', async () => {
    const queries: string[] = [];
    const migration = new NormalizeSubjectCatalog20260827260000();
    const queryRunner = {
      query: jest.fn((sql: string) => {
        queries.push(sql.replace(/\s+/g, ' ').trim());
        return Promise.resolve([]);
      }),
    };

    await migration.up(queryRunner as never);

    const sql = queries.join('\n');
    expect(sql).toContain("('HOMEROOM101', 'HOMEROOM')");
    expect(sql).toContain('active teacher assignment collision');
    expect(sql).toContain('curriculum collision contains content or classroom coverage');
    for (const table of [
      'attendance_import_files',
      'attendance_sessions',
      'classroom_teacher_assignments',
      'curriculum_subjects',
      'school_subjects',
      'task_links',
      'timetable_slots',
    ]) {
      expect(sql).toContain(`UPDATE ${table} consumer`);
    }
    expect(sql).toContain('DELETE FROM subjects duplicate_subject');
    expect(sql).toContain('attendance session collision requires manual reconciliation');
    expect(sql).toContain('DELETE FROM school_subjects duplicate_school_subject');
    expect(sql).toContain('final subject-code reconciliation failed');
  });

  it('fails closed on down because merged identities cannot be reconstructed', async () => {
    const migration = new NormalizeSubjectCatalog20260827260000();
    await expect(migration.down()).rejects.toThrow('restore the pre-migration database backup');
  });
});
