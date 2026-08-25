import { RiskProfileRepository } from './risk-profile.repository';

const THRESHOLDS = { highAbsentDays: 3 };

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
      ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
    ]);
    expect(queries[0].sql).toContain('INSERT INTO student_risk_profiles');
    expect(queries[0].sql).toContain('WHERE s.student_uuid = ANY($2::uuid[])');
    // The day verdict is no longer derived here: risk reads the shared
    // attendance_day view so every screen counts the same day the same way.
    expect(queries[0].sql).toContain('FROM attendance_day day');
    expect(queries[0].sql).toContain('(day."AttendanceStatus" = 2) AS is_absent_day');
    expect(queries[0].sql).toContain("a.session_kind = 'SUBJECT'");
    expect(queries[0].sql).toContain('teacher_signal_summary');
    expect(queries[0].sql).toContain("comment.concern_level_code IN ('WATCH', 'CONCERN')");
    // Teacher concern now has one source: the comment a teacher writes.
    expect(queries[0].sql).not.toContain('student_observations');
    expect(queries[0].sql).toContain('ON CONFLICT (student_uuid) DO UPDATE SET');
    expect(queries[0].sql).toContain('JOIN student_current_enrollment_resolution');
    expect(queries[0].sql).toContain('case_completion_baselines');
    expect(queries[0].sql).toContain("tracked_case.status = 'RESOLVED'");
    expect(queries[0].sql).toContain('classified_term_days');
    expect(queries[0].sql).toContain('term_attendance_summary');
    expect(queries[0].sql).toContain(
      'term_days.attendance_date > COALESCE(baseline.reset_after_date',
    );
    expect(queries[0].sql).toContain('term_absent_days');
    expect(queries[0].sql).toContain('absence_reset_after_date');
  });

  it('recalculates all active enrollments without a student filter', async () => {
    const { queries, repository } = createRepository([{ evaluated: 5, changed: 5 }]);

    await repository.recalculateAll(THRESHOLDS);

    expect(queries[0].params).toEqual([3]);
    expect(queries[0].sql).not.toContain('ANY($2::uuid[])');
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
      'absent_days_since_case_reset',
      'term_absent_days',
      'absence_reset_after_date',
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

  it('reads the single absence threshold that drives every tier', async () => {
    const { queries, repository } = createRepository([
      { setting_key: 'CASE_RISK_HIGH_ABSENCE_DAYS', setting_value: '4' },
    ]);

    const thresholds = await repository.getRiskThresholds();

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('setting_key = ANY($1::text[])');
    expect(thresholds.highAbsentDays).toBe(4);
  });

  it('falls back to the documented default when the threshold row is missing', async () => {
    const { repository } = createRepository([]);

    expect((await repository.getRiskThresholds()).highAbsentDays).toBe(3);
  });

  it('scores three tiers: absence for HIGH, any teacher comment for WATCH', async () => {
    const { queries, repository } = createRepository([{ evaluated: 1, changed: 1 }]);

    await repository.recalculateAll(THRESHOLDS);

    const sql = queries[0].sql.replace(/\s+/g, ' ');
    expect(sql).toContain("WHEN metrics.absent_days_since_case_reset >= $1::int THEN 'HIGH'");
    expect(sql).toContain("WHEN metrics.teacher_signal_count > 0 THEN 'WATCH'");
    expect(sql).toContain("ELSE 'NORMAL'");
    expect(sql).not.toContain("'MEDIUM'");
    expect(sql).not.toContain("'LOW'");
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
