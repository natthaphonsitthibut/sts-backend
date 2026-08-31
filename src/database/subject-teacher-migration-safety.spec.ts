import { FillRemainingSubjectTeachers20260829140000 } from './migrations/20260829140000-FillRemainingSubjectTeachers';
import { TurnClassroomLinksIntoTeacherLinks20260830090000 } from './migrations/20260830090000-TurnClassroomLinksIntoTeacherLinks';

describe('subject and classroom-link migration safety', () => {
  it('does not invent teachers for unstaffed subjects', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve([]);
      }),
    };

    await new FillRemainingSubjectTeachers20260829140000().up(runner as never);
    expect(queries.join('\n')).not.toContain('INSERT INTO classroom_subject_teachers');
    expect(queries.join('\n')).not.toContain('school_teacher_memberships');
  });

  it('restores the original scoped classroom FK and index on rollback', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve([]);
      }),
    };

    await new TurnClassroomLinksIntoTeacherLinks20260830090000().down(runner as never);
    const sql = queries.join('\n');
    expect(sql).toContain('FOREIGN KEY (classroom_id, school_term_id, school_id)');
    expect(sql).toContain('REFERENCES school_classrooms(id, school_term_id, school_id)');
    expect(sql).toContain('CREATE INDEX idx_classroom_attendance_links_scope');
  });
});
