import { AttendanceRepository } from './attendance.repository';

function expectCurrentEnrollmentPolicy(sql: string) {
  expect(sql).toContain('student_current_enrollment_resolution');
  expect(sql).toContain("current_enrollment.resolution_state = 'ACTIVE'");
  expect(sql).toContain('current_enrollment.selected_student_uuid = s.student_uuid');
}

describe('AttendanceRepository', () => {
  function createRepository() {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const queryRunner = {
      connect: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { records: [], affected: 0 };
      }),
    };
    const dataSource = {
      createQueryRunner: jest.fn(() => queryRunner),
    };

    return {
      queries,
      repository: new AttendanceRepository(
        dataSource as never,
        undefined as never,
        undefined as never,
      ),
    };
  }

  it('persists the per-student mark time alongside the server recorded time', async () => {
    const { queries, repository } = createRepository();
    const executor = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };

    await repository.upsertAttendanceBatch(
      {
        studentIds: ['00000000-0000-4000-8000-000000000001'],
        statusCodes: [1],
        markedAt: ['2026-07-07T01:05:00.000Z'],
        date: '2026-07-07',
        period: 1,
        recordedBy: 'teacher',
        sessionId: '11111111-1111-4111-8111-111111111111',
        metadata: {
          SchoolID_Onec: 10010002,
          GradeLevelID_Onec: 1,
          RoomID_Onec: 1,
          AcademicYear_Onec: 2026,
          Semester_Onec: 1,
        },
      },
      executor,
    );

    // RecordedAt stays server-generated; only marked_at comes from the payload.
    expect(queries[0].sql).toContain('marked_at');
    expect(queries[0].sql).toContain('"RecordedAt" = now()');
    expect(queries[0].sql).toContain('marked_at = EXCLUDED.marked_at');
    expect(queries[0].sql).toContain('$13::timestamptz[]');
    expect(queries[0].params?.[12]).toEqual(['2026-07-07T01:05:00.000Z']);
  });

  it('filters the attendance roster through current enrollment policy', async () => {
    const { queries, repository } = createRepository();

    await repository.listStudents({ schoolId: 10010002, grade: 'ม.1', room: 1 });

    expect(queries).toHaveLength(1);
    expectCurrentEnrollmentPolicy(queries[0].sql);
    expect(queries[0].sql).toContain('s.student_number');
    expect(queries[0].sql).toContain('person.photo_storage_key');
    expect(queries[0].sql).toContain(
      'LEFT JOIN student_person person ON person.person_uuid = s.person_uuid',
    );
    expect(queries[0].sql).toContain('LEFT JOIN student_risk_profiles risk');
    expect(queries[0].sql).toContain('risk.term_absent_days');
    expect(queries[0].sql).toContain('risk.absence_reset_after_date');
    // Shared roster SQL: both rosters must keep serving หมายเหตุ and ความเสี่ยง.
    expect(queries[0].sql).toContain('risk.risk_tier');
    expect(queries[0].sql).toContain('classroom_student_comments');
    expect(queries[0].sql).not.toContain('FROM attendance a');
  });

  it('filters attendance room options through current enrollment policy', async () => {
    const { queries, repository } = createRepository();

    await repository.listRooms('ม.1', 10010002, { school_ids: [10010002] });

    expect(queries).toHaveLength(1);
    expectCurrentEnrollmentPolicy(queries[0].sql);
    expect(queries[0].sql).toContain('s."SchoolID_Onec" = ANY');
    expect(queries[0].params).toEqual(['ม.1', [10010002], 10010002]);
  });

  it('validates writable roster ids through current enrollment policy', async () => {
    const { queries, repository } = createRepository();

    await repository.filterStudentIdsInScope(['00000000-0000-4000-8000-000000000001']);

    expect(queries).toHaveLength(1);
    expectCurrentEnrollmentPolicy(queries[0].sql);
  });

  it('upserts daily attendance through the DAILY partial unique index', async () => {
    const { queries, repository } = createRepository();
    const executor = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };

    await repository.upsertAttendanceBatch(
      {
        studentIds: ['00000000-0000-4000-8000-000000000001'],
        statusCodes: [1],
        markedAt: ['2026-07-07T01:05:00.000Z'],
        date: '2026-07-07',
        period: 1,
        recordedBy: 'teacher',
        sessionId: '11111111-1111-4111-8111-111111111111',
        metadata: {
          SchoolID_Onec: 10010002,
          GradeLevelID_Onec: 1,
          RoomID_Onec: 1,
          AcademicYear_Onec: 2026,
          Semester_Onec: 1,
        },
      },
      executor,
    );

    expect(queries[0].sql).toContain('session_kind');
    expect(queries[0].sql).toContain("'DAILY'");
    expect(queries[0].sql).toContain(
      'ON CONFLICT (student_uuid, "AttendanceDate") WHERE session_kind = \'DAILY\'',
    );
  });

  it('upserts subject attendance through the SUBJECT partial unique index', async () => {
    const { queries, repository } = createRepository();
    const executor = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };

    await repository.upsertAttendanceBatch(
      {
        studentIds: ['00000000-0000-4000-8000-000000000001'],
        statusCodes: [2],
        markedAt: [null],
        date: '2026-07-07',
        period: 3,
        sessionKind: 'SUBJECT',
        recordedBy: 'teacher',
        sessionId: '11111111-1111-4111-8111-111111111111',
        metadata: {
          SchoolID_Onec: 10010002,
          GradeLevelID_Onec: 1,
          RoomID_Onec: 1,
          AcademicYear_Onec: 2026,
          Semester_Onec: 1,
        },
      },
      executor,
    );

    expect(queries[0].params?.[9]).toBe('SUBJECT');
    expect(queries[0].sql).toContain(
      'ON CONFLICT (student_uuid, "AttendanceDate", "Period") WHERE session_kind = \'SUBJECT\'',
    );
  });

  it('reads existing statuses only from daily attendance rows', async () => {
    const { queries, repository } = createRepository();
    const executor = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return Promise.resolve({ rows: [], rowCount: 0 });
      }),
    };

    await repository.listAttendanceStatuses(
      ['00000000-0000-4000-8000-000000000001'],
      '2026-07-07',
      1,
      executor,
    );

    expect(queries[0].sql).toContain("AND session_kind = 'DAILY'");
  });
});
