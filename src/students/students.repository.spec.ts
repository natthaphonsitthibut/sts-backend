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

  it('builds the profile summary from one canonical row per recorded day', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.findStudentProfileSummary('00000000-0000-4000-8000-000000000001');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('s.term_gpa');
    expect(queries[0]).toContain('s."GPAX_Onec" AS cumulative_gpax');
    expect(queries[0]).toContain('term.starts_on::text AS starts_on');
    expect(queries[0]).toContain('term.ends_on::text AS ends_on');
    expect(queries[0]).toContain('LEFT JOIN attendance_day attendance');
    expect(queries[0]).toContain('attendance."AcademicYear_Onec" = s."AcademicYear_Onec"');
  });

  it('classifies recorded days from subject-period attendance without a calendar dependency', async () => {
    const queries: string[] = [];
    const repository = createRepositoryWithQueryCapture(queries);

    await repository.listStudentAttendanceCalendar('00000000-0000-4000-8000-000000000001');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("attendance.session_kind = 'SUBJECT'");
    expect(queries[0]).not.toContain("attendance.session_kind = 'DAILY'");
    expect(queries[0]).toContain('GROUP BY attendance."AttendanceDate"');
    expect(queries[0]).not.toContain('school_calendar_days');
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
    expect(queries[0]).not.toContain('school_calendar_days');
    expect(queries[0]).toContain('LEFT JOIN subjects subject');
    expect(queries[0]).toContain('LEFT JOIN teachers recorder');
    expect(queries[0]).toContain(
      'LEFT JOIN users recorder_user ON recorder_user.username = attendance."RecordedBy"',
    );
    expect(queries[0]).toContain('recorder_user."FirstName"');
    expect(queries[0]).toContain('recorder_user."LastName"');
    expect(queries[0]).toContain('AS recorded_by');
    expect(queries[0]).toContain('ORDER BY attendance_session.checking_started_at ASC NULLS LAST');
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
    expect(queries[0]).toContain('FROM classroom_homeroom_teacher_assignments assignment');
    expect(queries[0]).toContain('string_agg');
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

describe('StudentsRepository management writes', () => {
  it('rejects a disabled or technical status inside the create transaction', async () => {
    const queries: string[] = [];
    const manager = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM school_classrooms classroom')) {
          return Promise.resolve([
            {
              id: '99',
              school_id: 10010002,
              school_term_id: '1',
              grade_level_id: 7,
              legacy_room_number: 1,
              academic_year: 2569,
              semester: 1,
            },
          ]);
        }
        if (sql.includes('FROM student_status')) return Promise.resolve([]);
        return Promise.resolve([]);
      }),
    };
    const repository = new StudentsRepository({
      transaction: (work: (value: typeof manager) => unknown) => work(manager),
    } as never);

    await expect(
      repository.createStudent(
        {
          PersonID_Onec: '1234567890123',
          FirstName_Onec: 'สมชาย',
          LastName_Onec: 'ใจดี',
          classroom_id: 99,
          student_status_code: 999,
        },
        5,
      ),
    ).resolves.toEqual({ invalidStatus: true });
    expect(queries.join('\n')).toContain("category <> 'UNMATCHED'");
    expect(queries.join('\n')).not.toContain('INSERT INTO student_person');
  });

  it('inserts a valid student term with matching columns and values', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn((sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('FROM school_classrooms classroom')) {
          return Promise.resolve([
            {
              id: '99',
              school_id: 10010002,
              school_term_id: '1',
              grade_level_id: 7,
              legacy_room_number: 1,
              academic_year: 2569,
              semester: 1,
            },
          ]);
        }
        if (sql.includes('FROM student_status')) return Promise.resolve([{ code: 10 }]);
        if (sql.includes('FROM student_person_identifier')) return Promise.resolve([]);
        if (sql.includes('INSERT INTO student_person (')) {
          return Promise.resolve([{ person_uuid: '10000000-0000-4000-8000-000000000001' }]);
        }
        if (sql.includes('INSERT INTO student_term (')) {
          return Promise.resolve([{ student_uuid: '20000000-0000-4000-8000-000000000001' }]);
        }
        return Promise.resolve([]);
      }),
    };
    const repository = new StudentsRepository({
      transaction: (work: (value: typeof manager) => unknown) => work(manager),
    } as never);

    await expect(
      repository.createStudent(
        {
          PersonID_Onec: '1234567890123',
          FirstName_Onec: 'สมชาย',
          LastName_Onec: 'ใจดี',
          classroom_id: 99,
          student_status_code: 10,
        },
        5,
      ),
    ).resolves.toEqual({ studentUuid: '20000000-0000-4000-8000-000000000001' });

    const studentTermInsert = calls.find(({ sql }) => sql.includes('INSERT INTO student_term ('));
    expect(studentTermInsert?.params).toHaveLength(28);
    expect(studentTermInsert?.sql).toContain('$26, $27, $28, $28');
    expect(studentTermInsert?.sql).not.toContain('$29');
  });

  function buildUpdateStudentManager(options: { scopedRows?: unknown[] } = {}) {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const manager = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('FROM student_term s')) {
          return Promise.resolve(
            options.scopedRows ?? [{ person_uuid: '10000000-0000-4000-8000-000000000001' }],
          );
        }
        if (sql.includes('FROM student_term')) {
          return Promise.resolve([{ person_uuid: '10000000-0000-4000-8000-000000000001' }]);
        }
        if (sql.includes('FROM student_status')) return Promise.resolve([{ code: 20 }]);
        return Promise.resolve([]);
      }),
    };
    return { queries, manager };
  }

  it('updates enrollment, contact and guardians through one transaction manager', async () => {
    const { queries, manager } = buildUpdateStudentManager();
    const transaction = jest.fn((work: (value: typeof manager) => unknown) => work(manager));
    const repository = new StudentsRepository({ transaction } as never);

    await expect(
      repository.updateStudent(
        '00000000-0000-4000-8000-000000000001',
        { FirstName_Onec: 'สมศรี', student_status_code: 20 },
        { phone: '0812345678' },
        [{ relation: 'MOTHER', first_name: 'สมหญิง', last_name: 'ใจดี' }],
        5,
        undefined,
      ),
    ).resolves.toEqual({ updated: true });

    expect(transaction).toHaveBeenCalledTimes(1);
    const sql = queries.map(({ sql: text }) => text).join('\n');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain("category <> 'UNMATCHED'");
    expect(sql).toContain('INSERT INTO student_person_contact');
    expect(sql).toContain('UPDATE student_guardian');
    expect(sql).toContain('INSERT INTO student_guardian');
    expect(sql).toContain('UPDATE student_term SET');
  });

  it('re-reads the locked enrollment through the actor scope before writing', async () => {
    const { queries, manager } = buildUpdateStudentManager();
    const transaction = jest.fn((work: (value: typeof manager) => unknown) => work(manager));
    const repository = new StudentsRepository({ transaction } as never);

    await expect(
      repository.updateStudent(
        '00000000-0000-4000-8000-000000000001',
        { FirstName_Onec: 'สมศรี' },
        undefined,
        undefined,
        5,
        { school_ids: [10010003] },
      ),
    ).resolves.toEqual({ updated: true });

    const lockIndex = queries.findIndex(({ sql }) => sql.includes('FOR UPDATE'));
    const scopedIndex = queries.findIndex(({ sql }) => sql.includes('FROM student_term s'));
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    // The scope check must observe the state the lock froze, not the state the
    // caller saw before the transaction started.
    expect(scopedIndex).toBeGreaterThan(lockIndex);
    expect(queries[scopedIndex]?.sql).toContain('"SchoolID_Onec"');
    expect(queries[scopedIndex]?.params).toContainEqual([10010003]);
  });

  it('refuses the write when the locked enrollment left the actor scope', async () => {
    const { queries, manager } = buildUpdateStudentManager({ scopedRows: [] });
    const transaction = jest.fn((work: (value: typeof manager) => unknown) => work(manager));
    const repository = new StudentsRepository({ transaction } as never);

    await expect(
      repository.updateStudent(
        '00000000-0000-4000-8000-000000000001',
        { FirstName_Onec: 'สมศรี' },
        undefined,
        undefined,
        5,
        { school_ids: [10010003] },
      ),
    ).resolves.toEqual({ scopeConflict: true });

    expect(queries.some(({ sql }) => sql.includes('UPDATE student_term SET'))).toBe(false);
  });

  it('corrects the scoped enrollment and canonical national-id row together', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const manager = {
      query: jest.fn((sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('SELECT s.person_uuid')) {
          return Promise.resolve([
            {
              person_uuid: '10000000-0000-4000-8000-000000000001',
              national_id: '9876543210123',
              school_id: 10010002,
            },
          ]);
        }
        if (sql.includes('AS in_scope')) {
          return Promise.resolve([
            {
              student_uuid: '00000000-0000-4000-8000-000000000001',
              national_id: '9876543210123',
              in_scope: true,
            },
            {
              student_uuid: '00000000-0000-4000-8000-000000000002',
              national_id: '1234567890123',
              in_scope: true,
            },
          ]);
        }
        if (sql.includes('UNION ALL')) return Promise.resolve([]);
        if (sql.includes('SELECT id FROM updated_identifier')) {
          return Promise.resolve([{ id: '55' }]);
        }
        return Promise.resolve([]);
      }),
    };
    const repository = new StudentsRepository({} as never);

    await expect(
      repository.correctNationalId(
        '00000000-0000-4000-8000-000000000001',
        '9876543210123',
        5,
        { school_ids: [10010002] },
        manager as never,
      ),
    ).resolves.toEqual({ corrected: true, schoolId: 10010002 });

    const sql = calls.map((call) => call.sql).join('\n');
    expect(sql).toContain('s."SchoolID_Onec" = ANY');
    expect(sql).toContain('FOR UPDATE OF s');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain('UPDATE student_term');
    expect(sql).toContain('WHERE person_uuid = $1');
    expect(sql).toContain('UPDATE student_person_identifier');
    expect(sql).toContain('source = $3');
    expect(calls.some((call) => call.params.includes('MANUAL_CORRECTION'))).toBe(true);
  });

  it('fails closed when the canonical person has an enrollment outside actor scope', async () => {
    const queries: string[] = [];
    const manager = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT s.person_uuid')) {
          return Promise.resolve([
            {
              person_uuid: '10000000-0000-4000-8000-000000000001',
              national_id: '1234567890123',
              school_id: 10010002,
            },
          ]);
        }
        if (sql.includes('AS in_scope')) {
          return Promise.resolve([
            {
              student_uuid: '00000000-0000-4000-8000-000000000001',
              national_id: '1234567890123',
              in_scope: true,
            },
            {
              student_uuid: '00000000-0000-4000-8000-000000000002',
              national_id: '1234567890123',
              in_scope: false,
            },
          ]);
        }
        return Promise.resolve([]);
      }),
    };
    const repository = new StudentsRepository({} as never);

    await expect(
      repository.correctNationalId(
        '00000000-0000-4000-8000-000000000001',
        '9876543210123',
        5,
        { school_ids: [10010002] },
        manager as never,
      ),
    ).resolves.toEqual({ scopeConflict: true });
    expect(queries.join('\n')).not.toContain('UPDATE student_term');
    expect(queries.join('\n')).not.toContain('UPDATE student_person_identifier');
  });

  it('does not write when the replacement national id belongs to another person', async () => {
    const queries: string[] = [];
    const manager = {
      query: jest.fn((sql: string) => {
        queries.push(sql);
        if (sql.includes('SELECT s.person_uuid')) {
          return Promise.resolve([
            {
              person_uuid: '10000000-0000-4000-8000-000000000001',
              national_id: '1234567890123',
              school_id: 10010002,
            },
          ]);
        }
        if (sql.includes('AS in_scope')) {
          return Promise.resolve([
            {
              student_uuid: '00000000-0000-4000-8000-000000000001',
              national_id: '1234567890123',
              in_scope: true,
            },
          ]);
        }
        if (sql.includes('UNION ALL')) return Promise.resolve([{ exists: 1 }]);
        return Promise.resolve([]);
      }),
    };
    const repository = new StudentsRepository({} as never);

    await expect(
      repository.correctNationalId(
        '00000000-0000-4000-8000-000000000001',
        '9876543210123',
        5,
        undefined,
        manager as never,
      ),
    ).resolves.toEqual({ conflict: true });
    expect(queries.join('\n')).not.toContain('UPDATE student_term');
    expect(queries.join('\n')).not.toContain('UPDATE student_person_identifier');
  });
});
