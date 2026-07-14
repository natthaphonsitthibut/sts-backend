import { AddStudentObservationSoftDeleteTimestamp20260714300000 } from '../database/migrations/20260714300000-AddStudentObservationSoftDeleteTimestamp';

describe('AddStudentObservationSoftDeleteTimestamp20260714300000', () => {
  it('adds the nullable active-row marker and a matching partial timeline index', async () => {
    const query = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const migration = new AddStudentObservationSoftDeleteTimestamp20260714300000();

    await migration.up({ query } as never);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('ADD COLUMN deleted_at TIMESTAMPTZ');
    expect(sql).toContain('DROP INDEX idx_student_observations_student_timeline');
    expect(sql).toContain('CREATE INDEX idx_student_observations_student_timeline');
    expect(sql).toContain('WHERE deleted_at IS NULL');
  });

  it('removes the index before the column on rollback', async () => {
    const query = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    const migration = new AddStudentObservationSoftDeleteTimestamp20260714300000();

    await migration.down({ query } as never);

    const sql = String(query.mock.calls[0]?.[0]);
    expect(sql).toContain('CREATE INDEX idx_student_observations_student_timeline');
    expect(sql).not.toContain('WHERE deleted_at IS NULL');
    expect(sql.indexOf('CREATE INDEX')).toBeLessThan(sql.indexOf('DROP COLUMN'));
  });
});
