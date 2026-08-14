import { NotificationsRepository } from './notifications.repository';

function createRepository(records: Array<Record<string, unknown>> = []) {
  let sql = '';
  let params: unknown[] | undefined;
  const query = (nextSql: string, nextParams?: unknown[]) => {
    sql = nextSql;
    params = nextParams;
    return Promise.resolve({ records });
  };
  const queryRunner = { connect: jest.fn(), query, release: jest.fn() };
  return {
    getLastQuery: () => ({ params, sql }),
    queryRunner,
    repository: new NotificationsRepository({
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as never),
  };
}

describe('NotificationsRepository', () => {
  it('persists a typed case status for each eligible recipient', async () => {
    const { getLastQuery, repository } = createRepository([{ recipient_user_id: 42 }]);

    await expect(
      repository.fanOut({
        typeCode: 'CASE_STATUS_CHANGED',
        title: 'เคสเปลี่ยนสถานะ: รอติดตาม',
        body: 'ด***ม',
        refEntity: 'case',
        refId: '17',
        schoolId: 10010002,
        caseId: 17,
        caseStatusCode: 'IN_PROGRESS',
        studentNameMasked: 'ด***ม',
        reasonText: 'ขาดเรียนติดต่อกัน 3 วัน',
      }),
    ).resolves.toEqual([42]);

    const { params, sql } = getLastQuery();
    expect(sql).toContain('case_id, case_status_code, student_name_masked');
    expect(sql).toContain('u.permissions ? nt.required_permission');
    expect(sql).toContain("u.data_origin_code <> 'AUTOMATED_TEST'");
    expect(params?.at(14)).toBe('IN_PROGRESS');
  });

  it('filters the inbox by read state', async () => {
    const { getLastQuery, repository } = createRepository();

    await expect(repository.listForRecipient(42, { status: 'read' })).resolves.toEqual({
      rows: [],
      totalCount: 0,
    });

    const { params, sql } = getLastQuery();
    expect(sql).toContain("$2::text = 'read' AND n.read_at IS NOT NULL");
    expect(params).toEqual([42, 'read', 20, 0]);
  });
});
