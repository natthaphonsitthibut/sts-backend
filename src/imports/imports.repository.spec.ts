import { ImportsRepository } from './imports.repository';

describe('ImportsRepository bulk student-term import', () => {
  it('treats only active schools as valid import references', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: 1001 }] }),
    };
    const repository = new ImportsRepository({} as never);

    await expect(repository.findExistingSchoolIds([1001, 2002], executor)).resolves.toEqual([1001]);
    expect(executor.query).toHaveBeenCalledWith(expect.stringMatching(/school_status = 'ACTIVE'/), [
      [1001, 2002],
    ]);
  });

  it('resolves only active canonical classroom references', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            school_id: 1001,
            academic_year: 2569,
            semester: 1,
            grade_level_id: 423,
            room_number: 1,
          },
        ],
      }),
    };
    const repository = new ImportsRepository({} as never);

    await repository.findExistingClassroomReferences(
      [
        {
          schoolId: 1001,
          academicYear: 2569,
          semester: 1,
          gradeLevelId: 423,
          roomNumber: 1,
        },
      ],
      executor,
    );

    expect(executor.query).toHaveBeenCalledWith(
      expect.stringMatching(/JOIN school_classrooms[\s\S]*classroom_status = 'ACTIVE'/),
      [
        JSON.stringify([
          {
            school_id: 1001,
            academic_year: 2569,
            semester: 1,
            grade_level_id: 423,
            room_number: 1,
          },
        ]),
      ],
    );
  });

  it('resolves assignment teachers only through active membership in the selected school', async () => {
    const executor = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const repository = new ImportsRepository({} as never);

    await repository.findAssignmentTeacherReferences(1001, ['teacher.a'], executor);

    expect(executor.query).toHaveBeenCalledWith(
      expect.stringMatching(
        /school_teacher_memberships membership[\s\S]*membership\.school_id = \$1[\s\S]*membership_status = 'ACTIVE'/,
      ),
      [1001, ['teacher.a']],
    );
  });

  it('writes classroom assignments with server-injected school and classroom references', async () => {
    const executor = {
      query: jest.fn().mockResolvedValue({ rows: [{ id: '901' }], rowCount: 1 }),
    };
    const repository = new ImportsRepository({} as never);

    await expect(
      repository.insertClassroomAssignmentImportRow(
        {
          schoolId: 1001,
          classroomId: 501,
          teacherMembershipId: '701',
          subjectId: null,
          assignmentKind: 'HOMEROOM',
          effectiveOn: null,
          effectiveUntil: null,
          actorUserId: 11,
        },
        executor,
      ),
    ).resolves.toBe('901');
    expect(executor.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT DO NOTHING'), [
      1001,
      501,
      '701',
      null,
      'HOMEROOM',
      null,
      null,
      11,
    ]);
  });

  it('upserts student terms in one statement per chunk and counts insert/update results', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const executor = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return Promise.resolve({
          rows: [{ inserted: true }, { inserted: false }],
          rowCount: 2,
        });
      }),
    };
    const repository = new ImportsRepository({} as never);

    const result = await repository.bulkUpsertStudentTerms(
      [
        {
          person_uuid: '00000000-0000-4000-8000-000000000001',
          PersonID_Onec: '1111111111111',
          AcademicYear_Onec: 2567,
          Semester_Onec: 1,
          SchoolID_Onec: 1001,
          FirstName_Onec: 'หนึ่ง',
        },
        {
          person_uuid: '00000000-0000-4000-8000-000000000002',
          PersonID_Onec: '2222222222222',
          AcademicYear_Onec: 2567,
          Semester_Onec: 1,
          SchoolID_Onec: 1001,
          LastName_Onec: 'สอง',
        },
      ],
      executor,
    );

    expect(result).toEqual({ inserted: 1, updated: 1 });
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain('INSERT INTO student_term');
    expect(queries[0].sql).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7)');
    expect(queries[0].sql).toContain('($8, $9, $10, $11, $12, $13, $14)');
    expect(queries[0].sql).toContain(
      'ON CONFLICT ("person_uuid", "AcademicYear_Onec", "Semester_Onec", "SchoolID_Onec")',
    );
    expect(queries[0].sql).toContain('RETURNING (xmax = 0) AS inserted');
    expect(queries[0].params).toHaveLength(14);
  });

  it('chunks large student-term imports to keep query parameters bounded', async () => {
    const queries: Array<{ sql: string; params?: unknown[] }> = [];
    const executor = {
      query: jest.fn((sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return Promise.resolve({
          rows: Array.from({ length: (params?.length ?? 0) / 5 }, () => ({ inserted: true })),
          rowCount: (params?.length ?? 0) / 5,
        });
      }),
    };
    const repository = new ImportsRepository({} as never);
    const rows = Array.from({ length: 501 }, (_, index) => ({
      person_uuid: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      PersonID_Onec: String(index + 1).padStart(13, '0'),
      AcademicYear_Onec: 2567,
      Semester_Onec: 1,
      SchoolID_Onec: 1001,
    }));

    const result = await repository.bulkUpsertStudentTerms(rows, executor);

    expect(result).toEqual({ inserted: 501, updated: 0 });
    expect(queries).toHaveLength(2);
    expect(queries[0].params).toHaveLength(2_500);
    expect(queries[1].params).toHaveLength(5);
  });

  it('rejects non-whitelisted columns before generating SQL', async () => {
    const executor = { query: jest.fn() };
    const repository = new ImportsRepository({} as never);

    await expect(
      repository.bulkUpsertStudentTerms(
        [
          {
            person_uuid: '00000000-0000-4000-8000-000000000001',
            AcademicYear_Onec: 2567,
            Semester_Onec: 1,
            SchoolID_Onec: 1001,
            raw_secret_column: 'blocked',
          },
        ],
        executor,
      ),
    ).rejects.toThrow('Illegal import column for student_term: raw_secret_column');
    expect(executor.query).not.toHaveBeenCalled();
  });
});
