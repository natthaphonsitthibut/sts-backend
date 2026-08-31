import { AddAttendanceSubmissionHistory20260830160000 } from './migrations/20260830160000-AddAttendanceSubmissionHistory';

describe('AddAttendanceSubmissionHistory20260830160000', () => {
  it('adds immutable scoped history, per-student changes, and stale-write protection', async () => {
    const queries: string[] = [];
    const runner = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve([]);
      }),
    };
    const migration = new AddAttendanceSubmissionHistory20260830160000();

    await migration.up(runner as never);
    const upSql = queries.join('\n');
    expect(upSql).toContain('submission_number INTEGER NOT NULL DEFAULT 0');
    expect(upSql).toContain('lock_version INTEGER NOT NULL DEFAULT 1');
    expect(upSql).toContain('CREATE TABLE attendance_submission_history');
    expect(upSql).toContain('CREATE TABLE attendance_submission_changes');
    expect(upSql).toContain('FOREIGN KEY (session_id, student_uuid)');
    expect(upSql).toContain('actor_teacher_membership_id, school_id');
    expect(upSql).toContain('correction_reason IS NOT NULL');
    expect(upSql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(upSql).toContain('REVOKE ALL PRIVILEGES');
    expect(upSql).toContain('BEFORE UPDATE OR DELETE ON attendance_submission_history');
    expect(upSql).toContain('BEFORE UPDATE OR DELETE ON attendance_submission_changes');
    // The history's own guard has to let a parent row release its pointer,
    // otherwise `ON DELETE SET NULL` can never fire and deleting the user or
    // the link fails outright.
    expect(upSql).toContain('release_attendance_submission_history_parents');
    expect(upSql).toContain('pg_trigger_depth() > 1');
    expect(upSql).toContain("(to_jsonb(NEW) - 'actor_user_id' - 'classroom_attendance_link_id')");
    expect(upSql).toContain('NEW.actor_user_id IS NULL');
    expect(upSql).toContain('NEW.classroom_attendance_link_id IS NULL');
    // Only the history is relaxed; per-student changes stay strictly immutable.
    expect(upSql).toContain('prevent_attendance_submission_history_mutation()');

    queries.length = 0;
    await migration.down(runner as never);
    const downSql = queries.join('\n');
    expect(downSql).toContain('DROP TABLE attendance_submission_changes');
    expect(downSql).toContain('DROP TABLE attendance_submission_history');
    expect(downSql).toContain('DROP COLUMN lock_version');
    expect(downSql).toContain(
      'DROP FUNCTION IF EXISTS release_attendance_submission_history_parents',
    );
    expect(downSql).toContain(
      'DROP FUNCTION IF EXISTS prevent_attendance_submission_history_mutation',
    );
  });
});
