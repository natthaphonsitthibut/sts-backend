import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AuthenticatedRequestUser } from '../auth';
import type { AuditLogService } from '../audit-log/audit-log.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { CaseReportUpsRepository } from './case-report-ups.repository';
import { CaseReportUpsService } from './case-report-ups.service';

function actor(
  permissions: string[],
  dataScope: AuthenticatedRequestUser['data_scope'] = { school_ids: [101] },
): AuthenticatedRequestUser {
  return {
    id: 7,
    username: 'school.director',
    roles: ['DIRECTOR'],
    permissions,
    data_scope: dataScope,
    FirstName: 'ผอ.',
    LastName: 'โรงเรียน',
  };
}

describe('CaseReportUpsService', () => {
  let repository: jest.Mocked<
    Pick<
      CaseReportUpsRepository,
      | 'withTransaction'
      | 'lockSchoolOwnedCase'
      | 'insertReportUp'
      | 'transitionCaseToReportedUp'
      | 'listReportUps'
    >
  >;
  let auditLog: { recordAtomic: jest.Mock };
  let notifications: { notifyCaseStatusChanged: jest.Mock };
  let service: CaseReportUpsService;

  beforeEach(() => {
    repository = {
      withTransaction: jest.fn(async (operation) => await operation({} as never)),
      lockSchoolOwnedCase: jest.fn().mockResolvedValue({
        id: 10,
        status: 'IN_PROGRESS',
        school_id: 101,
        school_name: 'โรงเรียนทดสอบ',
        province: 'กรุงเทพมหานคร',
        district: 'เขตทดสอบ',
        sub_district: 'แขวงทดสอบ',
        student_name: 'นักเรียน ทดสอบ',
      }),
      insertReportUp: jest.fn().mockResolvedValue({
        id: '8ea6ec7c-45ce-45b4-aefa-f2cf3dd4da40',
        case_id: 10,
        case_status: 'REPORTED_UP',
        school_id: 101,
        school_name: 'โรงเรียนทดสอบ',
        student_name: null,
        reported_by: 7,
        reported_by_label: 'ผอ. โรงเรียน',
        report_reason: 'เกินขีดความสามารถของโรงเรียน',
        report_summary: 'ติดตามภายในแล้วแต่ยังต้องการการสนับสนุน',
        province_snapshot: 'กรุงเทพมหานคร',
        district_snapshot: 'เขตทดสอบ',
        sub_district_snapshot: 'แขวงทดสอบ',
        reported_at: '2026-07-14T12:00:00.000Z',
      }),
      transitionCaseToReportedUp: jest.fn().mockResolvedValue(true),
      listReportUps: jest.fn().mockResolvedValue({ rows: [], totalCount: 0 }),
    };
    auditLog = { recordAtomic: jest.fn().mockResolvedValue(undefined) };
    notifications = { notifyCaseStatusChanged: jest.fn().mockResolvedValue(undefined) };
    service = new CaseReportUpsService(
      repository as unknown as CaseReportUpsRepository,
      auditLog as unknown as AuditLogService,
      notifications as unknown as NotificationsService,
    );
  });

  it('denies report-up drill-down to an EXECUTIVE even when permission is re-granted', async () => {
    await expect(
      service.list(
        {},
        {
          ...actor(['report-up-cases']),
          roles: ['EXECUTIVE'],
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.listReportUps).not.toHaveBeenCalled();
  });

  it.each(['IN_PROGRESS', 'PENDING_REVIEW'])(
    'reports up a school-owned %s case',
    async (status) => {
      repository.lockSchoolOwnedCase.mockResolvedValueOnce({
        id: 10,
        status,
        school_id: 101,
        school_name: 'โรงเรียนทดสอบ',
        province: 'กรุงเทพมหานคร',
        district: null,
        sub_district: null,
        student_name: 'นักเรียน ทดสอบ',
      });

      const result = await service.reportUp(
        10,
        {
          reason: ' เกินขีดความสามารถของโรงเรียน ',
          summary: ' ติดตามภายในแล้วแต่ยังต้องการการสนับสนุน ',
        },
        actor(['review-cases', 'report-up-cases']),
      );

      expect(result.data.case_status).toBe('REPORTED_UP');
      expect(repository.lockSchoolOwnedCase).toHaveBeenCalledWith(10, [101], expect.anything());
      expect(repository.insertReportUp).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: 10,
          schoolId: 101,
          reason: 'เกินขีดความสามารถของโรงเรียน',
          summary: 'ติดตามภายในแล้วแต่ยังต้องการการสนับสนุน',
        }),
        expect.anything(),
      );
      expect(repository.transitionCaseToReportedUp).toHaveBeenCalledWith(
        10,
        status,
        expect.anything(),
      );
      expect(auditLog.recordAtomic).toHaveBeenCalledWith(
        {
          actorUserId: 7,
          actorLabel: 'ผอ. โรงเรียน',
          action: 'CASE_REVIEW',
          targetType: 'case',
          targetId: '10',
          metadata: {
            reviewAction: 'REPORT_UP',
            reportUpId: '8ea6ec7c-45ce-45b4-aefa-f2cf3dd4da40',
          },
          ip: null,
        },
        expect.anything(),
      );
    },
  );

  it('rejects mutation without the dedicated report-up permission', async () => {
    await expect(
      service.reportUp(10, { reason: 'ทดสอบ', summary: 'ทดสอบสิทธิ์' }, actor(['review-cases'])),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(repository.withTransaction).not.toHaveBeenCalled();
  });

  it('rejects a province/global actor even if a crafted report-up permission is present', async () => {
    await expect(
      service.reportUp(
        10,
        { reason: 'ทดสอบ', summary: 'ทดสอบขอบเขต' },
        actor(['review-cases', 'report-up-cases', 'executive-report'], {
          global: true,
          provinces: ['กรุงเทพมหานคร'],
        }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(repository.withTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when the case is outside the actor school scope', async () => {
    repository.lockSchoolOwnedCase.mockResolvedValueOnce(null);

    await expect(
      service.reportUp(
        10,
        { reason: 'ทดสอบ', summary: 'ทดสอบต่างโรงเรียน' },
        actor(['review-cases', 'report-up-cases']),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(repository.insertReportUp).not.toHaveBeenCalled();
  });

  it.each(['OPEN', 'RESOLVED', 'REPORTED_UP', 'AWAITING_HELP'])(
    'rejects invalid live transition from %s',
    async (status) => {
      repository.lockSchoolOwnedCase.mockResolvedValueOnce({
        id: 10,
        status,
        school_id: 101,
        school_name: 'โรงเรียนทดสอบ',
        province: null,
        district: null,
        sub_district: null,
        student_name: null,
      });

      await expect(
        service.reportUp(
          10,
          { reason: 'ทดสอบ', summary: 'ทดสอบสถานะ' },
          actor(['review-cases', 'report-up-cases']),
        ),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(repository.insertReportUp).not.toHaveBeenCalled();
    },
  );

  it('denies raw report-up rows to executive-only actors', async () => {
    await expect(
      service.list(
        { page: 1, limit: 20 },
        actor(['executive-report'], { provinces: ['กรุงเทพมหานคร'] }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(repository.listReportUps).not.toHaveBeenCalled();
  });
});
