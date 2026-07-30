import { NotificationsService } from './notifications.service';
import { maskName } from '../common/utils/helpers';

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

describe('NotificationsService structured student events', () => {
  it('writes only the student display fields required by each notification type', async () => {
    const repository = { fanOut: jest.fn().mockResolvedValue(1) };
    const service = new NotificationsService(repository as never);
    const studentName = 'เด็กชาย ทดสอบระบบ';
    const studentNameMasked = maskName(studentName);

    await service.notifyCaseCreated({
      caseId: 11,
      studentName,
      schoolId: 10010002,
      schoolName: 'โรงเรียนทดสอบ',
      reason: 'ขาดเรียนติดต่อกัน 3 วัน',
    });
    await service.notifyCaseStatusChanged({
      caseId: 11,
      studentName,
      schoolId: 10010002,
      nextStatus: 'IN_PROGRESS',
      actorUserId: 7,
    });
    await service.notifyCaseSlaWarning({
      caseId: 11,
      studentName,
      schoolId: 10010002,
      riskTier: 'HIGH',
      dueAt: '2026-08-03T00:00:00.000Z',
    });
    await service.notifyCaseSlaBreached({
      caseId: 11,
      studentName,
      schoolId: 10010002,
      riskTier: 'HIGH',
      dueAt: '2026-08-03T00:00:00.000Z',
    });
    await service.notifyCaseRiskEscalated({
      caseId: 11,
      studentName,
      schoolId: 10010002,
      fromTier: 'MEDIUM',
      toTier: 'HIGH',
      reason: 'ขาดเรียนติดต่อกัน 7 วัน',
    });
    await service.notifyStudentRiskWatch({
      studentUuid: '22222222-2222-4222-8222-222222222222',
      studentName,
      schoolId: 10010002,
      gradeLevel: '6',
      roomId: '1',
      reason: 'มาสาย 5 ครั้งใน 30 วัน',
      refId: '22222222-2222-4222-8222-222222222222:subject-late:30:5',
    });

    expect(repository.fanOut).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        typeCode: 'CASE_CREATED',
        caseId: 11,
        studentNameMasked,
        reasonText: 'ขาดเรียนติดต่อกัน 3 วัน',
      }),
    );
    expect(repository.fanOut).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        typeCode: 'CASE_STATUS_CHANGED',
        caseId: 11,
        studentNameMasked,
        body: studentNameMasked,
      }),
    );
    expect(repository.fanOut).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        typeCode: 'CASE_SLA_WARNING',
        caseId: 11,
        studentNameMasked,
        body: studentNameMasked,
      }),
    );
    expect(repository.fanOut).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({
        typeCode: 'CASE_SLA_BREACHED',
        caseId: 11,
        studentNameMasked,
        body: studentNameMasked,
      }),
    );
    expect(repository.fanOut).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({
        typeCode: 'CASE_RISK_ESCALATED',
        caseId: 11,
        studentNameMasked,
        reasonText: 'ขาดเรียนติดต่อกัน 7 วัน',
      }),
    );
    expect(repository.fanOut).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({
        typeCode: 'STUDENT_RISK_WATCH',
        studentUuid: '22222222-2222-4222-8222-222222222222',
        studentNameMasked,
        reasonText: 'มาสาย 5 ครั้งใน 30 วัน',
      }),
    );

    for (const [input] of repository.fanOut.mock.calls) {
      expect(input).not.toHaveProperty('riskTier');
      expect(input).not.toHaveProperty('dueAt');
      expect(input).not.toHaveProperty('fromTier');
      expect(input).not.toHaveProperty('toTier');
    }
  });

  it('returns relational student fields in the explicit list response', async () => {
    const repository = {
      listForRecipient: jest.fn().mockResolvedValue({
        rows: [
          {
            id: 'notification-1',
            type_code: 'CASE_CREATED',
            type_label: 'เคสใหม่',
            title: 'มีเคสติดตามใหม่',
            body: 'legacy body',
            student_person_uuid: '11111111-1111-4111-8111-111111111111',
            case_id: 11,
            student_name_masked: 'เด็กชาย ทด****',
            reason_text: 'ขาดเรียนติดต่อกัน 3 วัน',
            ref_entity: 'case',
            ref_id: '11',
            seen_at: null,
            read_at: null,
            created_at: '2026-07-31T00:00:00.000Z',
            total_count: 1,
          },
        ],
        totalCount: 1,
      }),
      countForRecipient: jest.fn().mockResolvedValue({ unreadCount: 1, unseenCount: 1 }),
    };
    const service = new NotificationsService(repository as never);

    await expect(service.listForUser(42, {})).resolves.toEqual(
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            student_person_uuid: '11111111-1111-4111-8111-111111111111',
            case_id: 11,
            student_name_masked: 'เด็กชาย ทด****',
            reason_text: 'ขาดเรียนติดต่อกัน 3 วัน',
          }),
        ],
      }),
    );
  });
});
