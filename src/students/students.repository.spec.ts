import { StudentsRepository } from './students.repository';

function createRepositoryWithQueryCapture(queries: string[]): StudentsRepository {
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    query: jest.fn((sql: string) => {
      queries.push(sql);
      if (sql.includes('COUNT(*)')) {
        return Promise.resolve([{ total: 0 }]);
      }
      return Promise.resolve([]);
    }),
  };

  return new StudentsRepository({
    createQueryRunner: () => queryRunner,
  } as never);
}

function expectCurrentEnrollmentPolicy(sql: string) {
  expect(sql).toContain('student_current_enrollment_resolution');
  expect(sql).toContain("current_enrollment.resolution_state = 'ACTIVE'");
  expect(sql).toContain('current_enrollment.selected_student_uuid = s.student_uuid');
}

describe('StudentsRepository roster queries', () => {
  it('filters student list through current enrollment policy by default', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.listStudents({});

    expect(queries).toHaveLength(2);
    expectCurrentEnrollmentPolicy(queries[0]);
    expectCurrentEnrollmentPolicy(queries[1]);
  });

  it('allows explicit all-enrollment student list mode', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.listStudents({ enrollmentState: 'all' });

    expect(queries).toHaveLength(2);
    expect(queries[0]).not.toContain('student_current_enrollment_resolution');
    expect(queries[1]).not.toContain('student_current_enrollment_resolution');
  });

  it('filters student list by canonical student status code', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.listStudents({ studentStatusCode: 20, enrollmentState: 'all' });

    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('COALESCE(s.student_status_code, s."StudentStatusID_Onec") = $1');
    expect(queries[1]).toContain('COALESCE(s.student_status_code, s."StudentStatusID_Onec") = $1');
  });

  it('filters student filter options through current enrollment policy by default', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.getStudentFilterOptions({});

    expect(queries).toHaveLength(2);
    expectCurrentEnrollmentPolicy(queries[0]);
    expectCurrentEnrollmentPolicy(queries[1]);
  });

  it('filters student filter options by canonical student status code', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.getStudentFilterOptions({ studentStatusCode: 10 });

    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('COALESCE(s.student_status_code, s."StudentStatusID_Onec")');
    expect(queries[1]).toContain('COALESCE(s.student_status_code, s."StudentStatusID_Onec")');
  });

  it('lists student attendance history from subject-period rows only', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.listAttendanceByStudentId('00000000-0000-4000-8000-000000000001');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("AND a.session_kind = 'SUBJECT'");
  });

  it('builds the profile summary from current-term subject attendance only', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.findStudentProfileSummary('00000000-0000-4000-8000-000000000001');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('s.term_gpa');
    expect(queries[0]).toContain('s."GPAX_Onec" AS cumulative_gpax');
    expect(queries[0]).toContain('term.starts_on::text AS starts_on');
    expect(queries[0]).toContain('term.ends_on::text AS ends_on');
    expect(queries[0]).toContain("attendance.session_kind = 'SUBJECT'");
    expect(queries[0]).not.toContain("attendance.session_kind = 'DAILY'");
    expect(queries[0]).toContain('attendance."AcademicYear_Onec" = s."AcademicYear_Onec"');
  });

  it('classifies calendar days from subject-period attendance without a daily fallback', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.listStudentAttendanceCalendar('00000000-0000-4000-8000-000000000001');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("attendance.session_kind = 'SUBJECT'");
    expect(queries[0]).not.toContain("attendance.session_kind = 'DAILY'");
    expect(queries[0]).toContain('GROUP BY attendance."AttendanceDate"');
    expect(queries[0]).toContain('attendance."AttendanceStatus" <> 4');
    expect(queries[0]).toContain('WHERE measured_periods > 0');
    expect(queries[0]).toContain('attendance."AttendanceDate"::text AS date');
    expect(queries[0]).toContain("THEN 'ALL_PERIODS'");
    expect(queries[0]).toContain("ELSE 'SOME_PERIODS'");
    expect(queries[0]).toContain("THEN 'NO_PERIODS'");
  });

  it('lists subject attendance for one selected date with canonical subject and status data', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.listStudentSubjectAttendanceByDate(
      '00000000-0000-4000-8000-000000000001',
      '2026-08-02',
    );

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("attendance.session_kind = 'SUBJECT'");
    expect(queries[0]).toContain('attendance."AttendanceDate" = $2::date');
    expect(queries[0]).toContain('JOIN attendance_record_statuses status');
    expect(queries[0]).toContain('LEFT JOIN subjects subject');
    expect(queries[0]).toContain('LEFT JOIN teachers recorder');
    expect(queries[0]).toContain(
      'LEFT JOIN users recorder_user ON recorder_user.username = attendance."RecordedBy"',
    );
    expect(queries[0]).toContain('recorder_user."FirstName"');
    expect(queries[0]).toContain('recorder_user."LastName"');
    expect(queries[0]).toContain('AS recorded_by');
  });

  it('loads the persisted risk tier with student detail and defaults missing profiles to normal', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.findStudentById('00000000-0000-4000-8000-000000000001');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain(
      'LEFT JOIN student_risk_profiles risk ON risk.student_uuid = s.student_uuid',
    );
    expect(queries[0]).toContain("COALESCE(risk.risk_tier, 'NORMAL') as risk_tier");
    expect(queries[0]).toContain('FROM classroom_homeroom_teachers assignment');
  });

  it('scopes the legacy case-by-name lookup through the linked enrollment', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.findCasesByStudentName('เด็ก ทดสอบ', { school_ids: [10010002] });

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('INNER JOIN student_term s ON s.student_uuid = c.student_uuid');
    expect(queries[0]).toContain('s."SchoolID_Onec" = ANY($2::int[])');
  });

  it('loads student case history by stable UUID', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.findCasesByStudentId('00000000-0000-4000-8000-000000000001');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('WHERE student_uuid = $1');
    expect(queries[0]).not.toContain('student_name =');
  });
});
