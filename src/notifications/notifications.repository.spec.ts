import { NotificationsRepository } from './notifications.repository';

describe('NotificationsRepository direct recipient eligibility', () => {
  it('requires active staff, a non-test origin, and effective permission', async () => {
    const query = jest
      .fn<Promise<{ records: Array<{ id: string }> }>, [sql: string, params?: unknown[]]>()
      .mockResolvedValue({ records: [{ id: 'notification-id' }] });
    const queryRunner = {
      connect: jest.fn(),
      query,
      release: jest.fn(),
    };
    const repository = new NotificationsRepository({
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as never);

    await expect(
      repository.createForEligibleRecipient({
        recipientUserId: 42,
        typeCode: 'IMPORT_COMPLETED',
        title: 'นำเข้าข้อมูลเสร็จแล้ว',
        refEntity: 'import',
        refId: 'batch-1',
      }),
    ).resolves.toBe(true);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("u.status = 'ACTIVE'");
    expect(sql).toContain("u.role IS DISTINCT FROM 'STUDENT'");
    expect(sql).toContain("u.data_origin_code <> 'AUTOMATED_TEST'");
    expect(sql).toContain('u.permissions ? nt.required_permission');
    expect(sql).toContain('r.default_permissions ? nt.required_permission');
    expect(params).toEqual([
      42,
      'IMPORT_COMPLETED',
      'นำเข้าข้อมูลเสร็จแล้ว',
      null,
      'import',
      'batch-1',
    ]);
    expect(queryRunner.release).toHaveBeenCalled();
  });

  it('persists typed student context for case fan-out', async () => {
    const query = jest
      .fn<
        Promise<{ records: Array<{ recipient_user_id: number }> }>,
        [sql: string, params?: unknown[]]
      >()
      .mockResolvedValue({ records: [{ recipient_user_id: 42 }] });
    const queryRunner = {
      connect: jest.fn(),
      query,
      release: jest.fn(),
    };
    const repository = new NotificationsRepository({
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as never);

    await expect(
      repository.fanOut({
        typeCode: 'CASE_CREATED',
        title: 'มีเคสติดตามใหม่',
        body: 'ด.ช. ทด**** · ขาดเรียนติดต่อกัน 3 วัน',
        refEntity: 'case',
        refId: '17',
        schoolId: 10010002,
        caseId: 17,
        studentNameMasked: 'ด.ช. ทด****',
        reasonText: 'ขาดเรียนติดต่อกัน 3 วัน',
      }),
    ).resolves.toEqual([42]);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('student_person_uuid, case_id, student_name_masked, reason_text');
    expect(sql).toContain('notification_case_student.person_uuid');
    expect(sql).toContain('notification_case.id = $10::int');
    expect(sql).toContain("NULLIF(btrim(notification_case.reason_flagged), '')");
    expect(params).toEqual([
      'CASE_CREATED',
      'มีเคสติดตามใหม่',
      'ด.ช. ทด**** · ขาดเรียนติดต่อกัน 3 วัน',
      'case',
      '17',
      null,
      10010002,
      null,
      null,
      17,
      null,
      'ด.ช. ทด****',
      'ขาดเรียนติดต่อกัน 3 วัน',
      [],
    ]);
  });

  it('skips recipients that were already notified for the same action', async () => {
    const query = jest
      .fn<
        Promise<{ records: Array<{ recipient_user_id: number }> }>,
        [sql: string, params?: unknown[]]
      >()
      .mockResolvedValue({ records: [] });
    const queryRunner = {
      connect: jest.fn(),
      query,
      release: jest.fn(),
    };
    const repository = new NotificationsRepository({
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as never);

    await repository.fanOut({
      typeCode: 'TASK_SUBMITTED',
      title: 'มีรายงานเยี่ยมบ้านส่งกลับ',
      refEntity: 'task',
      refId: 'task-1',
      excludeUserIds: [7, 9],
    });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('NOT (u.id = ANY($14::int[]))');
    expect(params?.[13]).toEqual([7, 9]);
  });
});
