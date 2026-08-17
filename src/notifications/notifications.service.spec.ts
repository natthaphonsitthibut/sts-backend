import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  it('fans out a typed case-status notification', async () => {
    const repository = {
      fanOut: jest.fn().mockResolvedValue([7, 8]),
      findCaseStatusNotificationContext: jest.fn().mockResolvedValue({
        completionOutcomeLabel: 'ปิดเคส',
        latestAbsentDate: '2026-08-15',
        latestTeacherComment: null,
        assignedTeacherName: 'ครูทดสอบ',
        reasonFlagged: 'ขาดเรียนสะสม 3 วัน',
        resultSummary: 'ผู้ปกครองรับทราบและจะติดตามการมาเรียน',
        reviewNote: 'เห็นควรปิดเคส',
        reviewSummary: null,
      }),
    };
    const service = new NotificationsService(repository as never);

    await expect(
      service.notifyCaseStatusChanged({
        caseId: 11,
        studentName: 'เด็กชาย ทดสอบระบบ',
        schoolId: 10010002,
        nextStatus: 'RESOLVED',
        completionOutcomeCode: 'CLOSED',
        actorUserId: 4,
      }),
    ).resolves.toEqual([7, 8]);

    expect(repository.fanOut).toHaveBeenCalledWith(
      expect.objectContaining({
        typeCode: 'CASE_STATUS_CHANGED',
        caseId: 11,
        caseStatusCode: 'RESOLVED',
        title: 'เคสเปลี่ยนสถานะ: เสร็จสิ้น : ปิดเคส',
        studentNameSnapshot: 'เด็กชาย ทดสอบระบบ',
        excludeUserId: 4,
        reasonText: 'ผลการพิจารณา: เห็นควรปิดเคส',
      }),
    );
  });

  it('maps an assigned case to its assignee and latest teacher comment', async () => {
    const repository = {
      fanOut: jest.fn().mockResolvedValue([7]),
      findCaseStatusNotificationContext: jest.fn().mockResolvedValue({
        completionOutcomeLabel: null,
        latestAbsentDate: '2026-08-15',
        latestTeacherComment: 'ผู้ปกครองรับทราบแล้ว',
        assignedTeacherName: 'ครูสมชาย ใจดี',
        reasonFlagged: 'ขาดเรียนสะสม 3 วัน',
        resultSummary: null,
        reviewNote: null,
        reviewSummary: null,
      }),
    };
    const service = new NotificationsService(repository as never);

    await service.notifyCaseStatusChanged({
      caseId: 11,
      studentName: 'เด็กชาย ทดสอบระบบ',
      schoolId: 10010002,
      nextStatus: 'IN_PROGRESS',
      actorUserId: 4,
    });

    expect(repository.fanOut).toHaveBeenCalledWith(
      expect.objectContaining({
        reasonText: 'มอบหมายให้: ครูสมชาย ใจดี · หมายเหตุ: ผู้ปกครองรับทราบแล้ว',
      }),
    );
  });

  it('keeps case transition best-effort when fan-out fails', async () => {
    const repository = {
      fanOut: jest.fn().mockRejectedValue(new Error('database unavailable')),
      findCaseStatusNotificationContext: jest.fn().mockResolvedValue(null),
    };
    const service = new NotificationsService(repository as never);

    await expect(
      service.notifyCaseStatusChanged({
        caseId: 12,
        studentName: null,
        schoolId: 10010002,
        nextStatus: 'OPEN',
        actorUserId: null,
      }),
    ).resolves.toEqual([]);
  });

  it('deletes notifications older than the 90-day retention window', async () => {
    const repository = { deleteOlderThan: jest.fn().mockResolvedValue(3) };
    const service = new NotificationsService(repository as never);
    const now = new Date('2026-07-04T03:30:00.000Z');

    await expect(service.cleanupExpiredNotifications(now)).resolves.toEqual({ deleted: 3 });
    expect(repository.deleteOlderThan).toHaveBeenCalledWith(new Date('2026-04-05T03:30:00.000Z'));
  });
});
