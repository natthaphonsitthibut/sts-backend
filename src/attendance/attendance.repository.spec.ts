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
});
