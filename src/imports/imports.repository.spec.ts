import { ImportsRepository } from './imports.repository';

describe('ImportsRepository bulk student-term import', () => {
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
