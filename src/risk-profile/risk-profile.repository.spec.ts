import { RiskProfileRepository } from './risk-profile.repository';

const THRESHOLDS = {
  lowConsecutiveAbsentDays: 3,
  mediumConsecutiveAbsentDays: 5,
  highConsecutiveAbsentDays: 7,
  watchProgressRatio: 0.7,
  lowAttendancePercent: 95,
  mediumAttendancePercent: 90,
  highAttendancePercent: 80,
  lateWeight: 0.25,
  subjectLateWindowDays: 30,
  subjectLateWatchCount: 5,
};

function createRepository(records: Array<Record<string, unknown>>) {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query: jest.fn((sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return { records, affected: 1 };
    }),
  };
  const dataSource = { createQueryRunner: jest.fn(() => queryRunner) };
  return { queries, repository: new RiskProfileRepository(dataSource as never) };
}

describe('RiskProfileRepository', () => {
  it('upserts risk profiles for selected active students', async () => {
    const { queries, repository } = createRepository([{ evaluated: 2, changed: 2 }]);

    const result = await repository.recalculateStudents(
      [
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
      ],
      THRESHOLDS,
    );

    expect(result).toEqual({ evaluated: 2, changed: 2, skipped: 0 });
    expect(queries).toHaveLength(1);
    expect(queries[0].params).toEqual([
      3,
      5,
      7,
      0.7,
      95,
      90,
      80,
      0.25,
      30,
      5,
      ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
    ]);
    expect(queries[0].sql).toContain('INSERT INTO student_risk_profiles');
    expect(queries[0].sql).toContain('WHERE s.student_uuid = ANY($11::uuid[])');
    expect(queries[0].sql).toContain("AND a.session_kind = 'DAILY'");
    expect(queries[0].sql).toContain("a.session_kind = 'SUBJECT'");
    expect(queries[0].sql).toContain('subject_late_count');
    expect(queries[0].sql).toContain('ON CONFLICT (student_uuid) DO UPDATE SET');
    expect(queries[0].sql).toContain('JOIN student_current_enrollment_resolution');
  });

  it('recalculates all active enrollments without a student filter', async () => {
    const { queries, repository } = createRepository([{ evaluated: 5, changed: 5 }]);

    await repository.recalculateAll(THRESHOLDS);

    expect(queries[0].params).toEqual([3, 5, 7, 0.7, 95, 90, 80, 0.25, 30, 5]);
    expect(queries[0].sql).not.toContain('ANY($11::uuid[])');
  });

  it('only rewrites a profile when a domain metric or the source watermark moved', async () => {
    const { queries, repository } = createRepository([{ evaluated: 5, changed: 5 }]);

    await repository.recalculateAll(THRESHOLDS);

    // Normalised so the assertion does not depend on SQL line wrapping.
    const sql = queries[0].sql.replace(/\s+/g, ' ');
    // The guard is what stops a no-op recalculation from bumping
    // profile_calculated_at/updated_at on every row.
    expect(sql).toContain('RETURNING student_uuid');
    for (const column of [
      'consecutive_absent_days',
      'absent_days',
      'late_count',
      'subject_late_count',
      'school_day_count',
      'weighted_absence_days',
      'weighted_attendance_percent',
      'risk_tier',
      'risk_severity',
      'risk_score',
      'open_case_count',
      'latest_open_case_id',
      'latest_open_task_id',
      'source_updated_at',
    ]) {
      expect(sql).toContain(`student_risk_profiles.${column} IS DISTINCT FROM EXCLUDED.${column}`);
    }
  });

  it('reports evaluated, changed and skipped counts so no-op passes are visible', async () => {
    const { repository } = createRepository([{ evaluated: 5980, changed: 3 }]);

    const result = await repository.recalculateAll(THRESHOLDS);

    expect(result).toEqual({ evaluated: 5980, changed: 3, skipped: 5977 });
  });

  it('loads every risk threshold in a single settings query', async () => {
    const { queries, repository } = createRepository([
      { setting_key: 'CASE_RISK_LOW_ABSENCE_DAYS', setting_value: '4' },
      { setting_key: 'SUBJECT_RISK_LATE_WATCH_COUNT', setting_value: '9' },
    ]);

    const thresholds = await repository.getRiskThresholds();

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('setting_key = ANY($1::text[])');
    expect(thresholds.lowConsecutiveAbsentDays).toBe(4);
    expect(thresholds.subjectLateWatchCount).toBe(9);
    // Keys absent from system_settings keep their documented defaults.
    expect(thresholds.highConsecutiveAbsentDays).toBe(7);
  });

  it('caps the missing-profile lookup so repair stays bounded', async () => {
    const { queries, repository } = createRepository([
      { student_uuid: '00000000-0000-4000-8000-000000000001' },
    ]);

    const missing = await repository.listMissingActiveProfileStudentUuids(500);

    expect(missing).toEqual(['00000000-0000-4000-8000-000000000001']);
    expect(queries[0].params).toEqual([500]);
    expect(queries[0].sql).toContain('LIMIT $1');
    expect(queries[0].sql).toContain('profile.student_uuid IS NULL');
  });
});
