import { EnforceAttendanceLinkSchoolScope20260830170000 } from './migrations/20260830170000-EnforceAttendanceLinkSchoolScope';

describe('EnforceAttendanceLinkSchoolScope20260830170000', () => {
  it('binds session and submit-history provenance to the same school as the link', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve([]);
      }),
    };
    const migration = new EnforceAttendanceLinkSchoolScope20260830170000();

    await migration.up(runner as never);
    const upSql = queries.join('\n');
    expect(upSql).toContain('UNIQUE (id, school_id)');
    expect(upSql).toContain('FOREIGN KEY (classroom_attendance_link_id, school_id)');
    expect(upSql).toContain('fk_attendance_sessions_classroom_link_school');
    expect(upSql).toContain('fk_attendance_submission_history_classroom_link_school');
    // A plain SET NULL would try to null school_id too and hit its NOT NULL, so
    // both name the one column to release. RESTRICT here would instead make a
    // link that was ever used permanently undeletable.
    expect(upSql).not.toContain('ON DELETE RESTRICT');
    expect(upSql.match(/ON DELETE SET NULL \(classroom_attendance_link_id\)/g)).toHaveLength(2);

    queries.length = 0;
    await migration.down(runner as never);
    expect(queries.join('\n')).toContain('DROP CONSTRAINT uq_classroom_attendance_links_id_school');
  });
});
