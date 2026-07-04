import { NotificationsService } from './notifications.service';

describe('NotificationsService retention cleanup', () => {
  function createService(repositoryOverrides: { deleteOlderThan?: jest.Mock } = {}) {
    const repository = {
      deleteOlderThan: jest.fn().mockResolvedValue(0),
      ...repositoryOverrides,
    };
    const service = new NotificationsService(repository as never);
    return { repository, service };
  }

  it('deletes notifications older than the 90-day retention window', async () => {
    const { repository, service } = createService({
      deleteOlderThan: jest.fn().mockResolvedValue(3),
    });
    const now = new Date('2026-07-04T03:30:00.000Z');

    await expect(service.cleanupExpiredNotifications(now)).resolves.toEqual({ deleted: 3 });

    expect(repository.deleteOlderThan).toHaveBeenCalledWith(new Date('2026-04-05T03:30:00.000Z'));
  });

  it('swallows scheduled cleanup failures after logging a warning', async () => {
    const { service } = createService({
      deleteOlderThan: jest.fn().mockRejectedValue(new Error('database unavailable')),
    });
    const logger = service as unknown as { logger: { warn: (message: string) => void } };
    const warnSpy = jest.spyOn(logger.logger, 'warn').mockImplementation();

    await expect(service.runRetentionCleanup()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      'Notification retention cleanup failed: database unavailable',
    );
    warnSpy.mockRestore();
  });
});

describe('NotificationsService import events', () => {
  it('creates a completion notification for the importing user', async () => {
    const repository = { createForEligibleRecipient: jest.fn().mockResolvedValue(true) };
    const service = new NotificationsService(repository as never);

    await service.notifyImportCompleted({
      batchId: 'batch-1',
      actorUserId: 42,
      targetLabel: 'ข้อมูลนักเรียนในระบบ (รายภาคเรียน)',
      importedRows: 12,
      quarantinedRows: 3,
    });

    expect(repository.createForEligibleRecipient).toHaveBeenCalledWith({
      recipientUserId: 42,
      typeCode: 'IMPORT_COMPLETED',
      title: 'นำเข้าข้อมูลเสร็จแล้ว',
      body: 'ข้อมูลนักเรียนในระบบ (รายภาคเรียน) · สำเร็จ 12 รายการ · รอตรวจ 3 รายการ',
      refEntity: 'import',
      refId: 'batch-1',
    });
  });

  it('keeps import failure notification best-effort', async () => {
    const repository = {
      createForEligibleRecipient: jest.fn().mockRejectedValue(new Error('database unavailable')),
    };
    const service = new NotificationsService(repository as never);

    await expect(
      service.notifyImportFailed({
        batchId: 'batch-2',
        actorUserId: 42,
        targetLabel: 'ข้อมูลนักเรียนออกกลางคัน',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('NotificationsService student-account batch events', () => {
  it('creates a count-only completion notification for the job owner', async () => {
    const repository = { createForEligibleRecipient: jest.fn().mockResolvedValue(true) };
    const service = new NotificationsService(repository as never);

    await service.notifyStudentAccountBatchCompleted({
      jobId: 'job-1',
      actorUserId: 5,
      createdCount: 20,
      skippedCount: 2,
      failedCount: 1,
    });

    expect(repository.createForEligibleRecipient).toHaveBeenCalledWith({
      recipientUserId: 5,
      typeCode: 'STUDENT_ACCOUNT_BATCH_COMPLETED',
      title: 'สร้างบัญชีนักเรียนเสร็จแล้ว',
      body: 'สร้าง 20 บัญชี · ข้าม 2 รายการ · ไม่สำเร็จ 1 รายการ',
      refEntity: 'student-account-batch',
      refId: 'job-1',
    });
  });

  it('creates a retry-oriented failure notification for the job owner', async () => {
    const repository = { createForEligibleRecipient: jest.fn().mockResolvedValue(true) };
    const service = new NotificationsService(repository as never);

    await service.notifyStudentAccountBatchFailed({ jobId: 'job-2', actorUserId: 5 });

    expect(repository.createForEligibleRecipient).toHaveBeenCalledWith({
      recipientUserId: 5,
      typeCode: 'STUDENT_ACCOUNT_BATCH_FAILED',
      title: 'สร้างบัญชีนักเรียนไม่สำเร็จ',
      body: 'เปิดประวัติงานเพื่อตรวจสอบและลองทำต่อ',
      refEntity: 'student-account-batch',
      refId: 'job-2',
    });
  });
});
