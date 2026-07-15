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

  it('includes the active link time range in the attendance task list', async () => {
    const { queries, repository } = createRepository();

    await repository.listAttendanceTasks();

    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('tl.created_at as active_link_created_at');
    expect(queries[0].sql).toContain('tl.expires_at as active_link_expires_at');
    expect(queries[0].sql).toContain("WHEN sess.status = 'SUBMITTED' THEN 'COMPLETED'");
    expect(queries[0].sql).toContain('FROM attendance_sessions attendance_session');
  });

  it('includes the active link time range in the paginated task list', async () => {
    const { queries, repository } = createRepository();

    await repository.listAttendanceTasksPaginated(undefined, {
      page: 1,
      limit: 20,
    });

    const listQuery = queries.at(-1);
    expect(listQuery?.sql).toContain('tl.created_at as active_link_created_at');
    expect(listQuery?.sql).toContain('tl.expires_at as active_link_expires_at');
    expect(listQuery?.sql).toContain('tl.expires_at <= NOW()');
    expect(listQuery?.sql).toContain('AS link_state');
    expect(listQuery?.sql).toContain("WHEN sess.status = 'SUBMITTED' THEN 'COMPLETED'");
    expect(listQuery?.sql).toContain('FROM attendance_sessions attendance_session');
  });

  it('applies every selected school area filter to paginated tasks', async () => {
    const { queries, repository } = createRepository();

    await repository.listAttendanceTasksPaginated(undefined, {
      page: 1,
      limit: 20,
      province: 'ขอนแก่น',
      district: 'เมืองขอนแก่น',
      subDistrict: 'ในเมือง',
    });

    const filteredQueries = queries.slice(1);
    expect(filteredQueries).toHaveLength(2);
    for (const query of filteredQueries) {
      expect(query.sql).toContain('sc.province = $1');
      expect(query.sql).toContain('sc.district = $2');
      expect(query.sql).toContain('sc.sub_district = $3');
    }
    expect(filteredQueries[0].params).toEqual(['ขอนแก่น', 'เมืองขอนแก่น', 'ในเมือง']);
  });

  it('filters the attendance roster through current enrollment policy', async () => {
    const { queries, repository } = createRepository();

    await repository.listStudents({ schoolId: 10010002, grade: 'ม.1', room: 1 });

    expect(queries).toHaveLength(1);
    expectCurrentEnrollmentPolicy(queries[0].sql);
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
