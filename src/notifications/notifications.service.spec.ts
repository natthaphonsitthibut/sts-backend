import { maskName } from '../common/utils/helpers';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  it('fans out a typed case-status notification', async () => {
    const repository = { fanOut: jest.fn().mockResolvedValue([7, 8]) };
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
        studentNameMasked: maskName('เด็กชาย ทดสอบระบบ'),
        excludeUserId: 4,
      }),
    );
  });

  it('keeps case transition best-effort when fan-out fails', async () => {
    const repository = { fanOut: jest.fn().mockRejectedValue(new Error('database unavailable')) };
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
