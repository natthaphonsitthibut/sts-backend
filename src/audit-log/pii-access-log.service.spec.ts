import { PiiAccessLogService, type PiiAccessLogInput } from './pii-access-log.service';

const INPUT: PiiAccessLogInput = {
  actorUserId: 5,
  actorLabel: 'admin',
  actorRoles: ['ADMIN'],
  subjectType: 'STUDENT',
  subjectRef: 'v1:keyed-reference',
  subjectRefKeyVersion: 1,
  fieldGroup: 'NATIONAL_ID',
  reasonCode: 'OTHER',
  reasonNote: 'ตรวจเอกสารย้ายเข้า',
  requestId: 'req-1',
  ip: '127.0.0.1',
  userAgent: 'jest',
  targetType: 'student',
  targetId: '00000000-0000-4000-8000-000000000001',
  scopeMetadata: { schoolId: 10010002 },
};

function createHarness() {
  const manager = { query: jest.fn().mockResolvedValue([]) };
  const dataSource = {
    transaction: jest.fn((work: (entityManager: typeof manager) => Promise<void>) => work(manager)),
  };
  const auditLog = { recordAtomicReturningId: jest.fn().mockResolvedValue('91') };
  const service = new PiiAccessLogService(dataSource as never, auditLog as never);
  return { service, manager, dataSource, auditLog };
}

describe('PiiAccessLogService', () => {
  it('writes the audit row and the access record that points at it in one transaction', async () => {
    const { service, manager, dataSource, auditLog } = createHarness();

    await service.record(INPUT);

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(auditLog.recordAtomicReturningId).toHaveBeenCalledWith(
      {
        action: 'STUDENT_NATIONAL_ID_VIEW',
        actorUserId: 5,
        actorLabel: 'admin',
        targetType: 'student',
        targetId: INPUT.targetId,
        metadata: {
          schoolId: 10010002,
          fieldGroup: 'NATIONAL_ID',
          reasonCode: 'OTHER',
          reasonLabel: 'อื่น ๆ (ระบุ)',
          reasonNote: 'ตรวจเอกสารย้ายเข้า',
        },
        ip: '127.0.0.1',
      },
      manager,
    );
    const [sql, params] = manager.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO pii_access_events');
    expect(sql).toContain('audit_log_id');
    expect(params).toEqual([
      5,
      null,
      '["ADMIN"]',
      'v1:keyed-reference',
      'STUDENT',
      1,
      'NATIONAL_ID',
      'OTHER',
      'ตรวจเอกสารย้ายเข้า',
      null,
      'req-1',
      '127.0.0.1',
      'jest',
      '91',
    ]);
  });

  it('names the action by whose record and which fields were opened', async () => {
    const { service, auditLog } = createHarness();

    await service.record({ ...INPUT, subjectType: 'USER', fieldGroup: 'ADDRESS' });
    await service.record({ ...INPUT, subjectType: 'TEACHER', fieldGroup: 'NATIONAL_ID' });

    expect(
      auditLog.recordAtomicReturningId.mock.calls.map(
        ([event]: [{ action: string }]) => event.action,
      ),
    ).toEqual(['USER_ADDRESS_VIEW', 'TEACHER_NATIONAL_ID_VIEW']);
  });

  it('refuses a reveal it has no audit action for instead of logging it unnamed', async () => {
    const { service, dataSource } = createHarness();

    await expect(
      service.record({ ...INPUT, subjectType: 'TEACHER', fieldGroup: 'ADDRESS' }),
    ).rejects.toThrow('No audit action for TEACHER ADDRESS reveal');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('writes no access record when the audit row cannot be written', async () => {
    const { service, manager, auditLog } = createHarness();
    auditLog.recordAtomicReturningId.mockRejectedValueOnce(new Error('audit outage'));

    await expect(service.record(INPUT)).rejects.toThrow('audit outage');
    expect(manager.query).not.toHaveBeenCalled();
  });
});
