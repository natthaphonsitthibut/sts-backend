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
});
