import { ForbiddenException, GoneException } from '@nestjs/common';
import { hashToken } from '../common/utils/helpers';
import { TaskPolicyService } from '../task/task-policy.service';
import { PiiExportRepository } from './pii-export.repository';
import { PiiExportService } from './pii-export.service';
import type { PiiExportRequestRow, PiiExportStudentRow } from './pii-export.types';

describe('PiiExportService', () => {
  let service: PiiExportService;
  let repository: jest.Mocked<
    Pick<
      PiiExportRepository,
      | 'countStudentsForScope'
      | 'createRequest'
      | 'insertRequestStudents'
      | 'insertEvent'
      | 'withTransaction'
      | 'listRequests'
      | 'findRequestById'
      | 'approveRequest'
      | 'rejectRequest'
      | 'claimDownload'
      | 'findRequestByTokenHash'
      | 'countRequestStudents'
      | 'listStudentsForExport'
      | 'claimExpiredRequests'
    >
  >;
  let taskPolicyService: jest.Mocked<
    Pick<
      TaskPolicyService,
      'normalizeScope' | 'isScopeSubsetOfActor' | 'getRoleMap' | 'getPrimaryRole' | 'getRoleRank'
    >
  >;

  const actor = {
    id: 10,
    username: 'requester',
    roles: ['SCHOOL_ADMIN'],
    permissions: ['students'],
    data_scope: { school_ids: [10010002] },
  };
  const approver = {
    id: 20,
    username: 'approver',
    roles: ['ADMIN'],
    permissions: ['students'],
    data_scope: { global: true },
  };

  function requestRow(overrides: Partial<PiiExportRequestRow> = {}): PiiExportRequestRow {
    return {
      id: '00000000-0000-4000-8000-000000000001',
      requester_user_id: actor.id,
      requester_username: actor.username,
      requester_name: 'Requester',
      approver_user_id: null,
      approver_username: null,
      approver_name: null,
      status: 'PENDING',
      scope_snapshot: { school_ids: [10010002] },
      include_full_national_id: false,
      reason_code: 'VERIFY_DATA',
      reason_note: 'ตรวจสอบข้อมูลตามคำขอ',
      row_estimate: 1,
      download_token_hash: null,
      download_expires_at: null,
      downloaded_at: null,
      rejected_reason: null,
      created_at: new Date('2026-07-05T00:00:00.000Z'),
      updated_at: new Date('2026-07-05T00:00:00.000Z'),
      ...overrides,
    };
  }

  const studentRow: PiiExportStudentRow = {
    PersonID_Onec: '1234567890123',
    PassportNumber_Onec: 'AA123456',
    FirstName_Onec: 'Smoke',
    LastName_Onec: 'Student',
    SchoolID_Onec: 10010002,
    school_name: 'Smoke School',
    grade: 'ม.6',
    RoomID_Onec: 1,
    student_status_label: 'ปกติ',
    VillageNumber_Onec: '1',
    Trok_Onec: null,
    Soi_Onec: null,
    Street_Onec: null,
    SubDistrictNameThai_Onec: 'สีกัน',
    DistrictNameThai_Onec: 'ดอนเมือง',
    ProvinceNameThai_Onec: 'กรุงเทพมหานคร',
    PostalCode_Onec: '10210',
  };

  beforeEach(() => {
    repository = {
      countStudentsForScope: jest.fn(),
      createRequest: jest.fn(),
      insertRequestStudents: jest.fn(),
      insertEvent: jest.fn(),
      withTransaction: jest.fn(async (callback) => callback({ query: jest.fn() })),
      listRequests: jest.fn(),
      findRequestById: jest.fn(),
      approveRequest: jest.fn(),
      rejectRequest: jest.fn(),
      claimDownload: jest.fn(),
      findRequestByTokenHash: jest.fn(),
      countRequestStudents: jest.fn(),
      listStudentsForExport: jest.fn(),
      claimExpiredRequests: jest.fn(),
    };
    taskPolicyService = {
      normalizeScope: jest.fn((scope) => ({
        global:
          scope && typeof scope === 'object' && (scope as { global?: boolean }).global === true,
        provinces: [],
        districts: [],
        sub_districts: [],
        school_ids: Array.isArray((scope as { school_ids?: unknown[] })?.school_ids)
          ? (scope as { school_ids: unknown[] }).school_ids.map(String)
          : [],
        grade_levels: [],
        room_ids: [],
        own_only: false,
      })),
      isScopeSubsetOfActor: jest.fn(() => true),
      getRoleMap: jest.fn(() =>
        Promise.resolve(
          new Map([
            [
              'ADMIN',
              {
                id: 1,
                name: 'ADMIN',
                label: 'Admin',
                rank: 5,
                default_permissions: ['students'],
                scope_mode: 'flexible',
                scope_policy: 'ASSIGNABLE',
                is_assignable: true,
                is_system: true,
              },
            ],
          ]),
        ),
      ),
      getPrimaryRole: jest.fn((user) => user?.roles?.[0] ?? null),
      getRoleRank: jest.fn((role) => (role === 'ADMIN' ? 5 : 0)),
    };
    service = new PiiExportService(
      repository as unknown as PiiExportRepository,
      taskPolicyService as unknown as TaskPolicyService,
    );
  });

  it('rejects export requests outside the actor scope', async () => {
    taskPolicyService.isScopeSubsetOfActor.mockReturnValueOnce(false);

    await expect(
      service.createRequest(
        actor,
        {
          scope: { school_ids: [99999999] },
          include_full_national_id: false,
          reason_code: 'VERIFY_DATA',
          reason_note: 'ตรวจสอบข้อมูล',
        },
        { ip: null },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(repository.countStudentsForScope).not.toHaveBeenCalled();
  });

  it('creates a selected-student export only when every student is in scope', async () => {
    repository.countStudentsForScope.mockResolvedValue(2);
    repository.createRequest.mockResolvedValue(requestRow({ row_estimate: 2 }));

    await service.createRequest(
      actor,
      {
        scope: { school_ids: [10010002] },
        selected_student_uuids: [
          '00000000-0000-4000-8000-000000000101',
          '00000000-0000-4000-8000-000000000102',
        ],
        include_full_national_id: false,
        reason_code: 'VERIFY_DATA',
        reason_note: 'ตรวจสอบข้อมูล',
      },
      { ip: null },
    );

    expect(repository.countStudentsForScope).toHaveBeenCalledWith({ school_ids: ['10010002'] }, [
      '00000000-0000-4000-8000-000000000101',
      '00000000-0000-4000-8000-000000000102',
    ]);
    expect(repository.insertRequestStudents).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000001',
      ['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102'],
      expect.anything(),
    );
  });

  it('rejects selected-student export when any selected student is out of scope', async () => {
    repository.countStudentsForScope.mockResolvedValue(1);

    await expect(
      service.createRequest(
        actor,
        {
          scope: { school_ids: [10010002] },
          selected_student_uuids: [
            '00000000-0000-4000-8000-000000000101',
            '00000000-0000-4000-8000-000000000999',
          ],
          include_full_national_id: false,
          reason_code: 'VERIFY_DATA',
          reason_note: 'ตรวจสอบข้อมูล',
        },
        { ip: null },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(repository.createRequest).not.toHaveBeenCalled();
  });

  it('rejects self approval', async () => {
    repository.findRequestById.mockResolvedValue(requestRow({ requester_user_id: approver.id }));

    await expect(
      service.approveRequest('request-id', approver, { ip: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(repository.approveRequest).not.toHaveBeenCalled();
  });

  it('approves with a hashed one-time token', async () => {
    repository.findRequestById.mockResolvedValue(requestRow({ requester_user_id: actor.id }));
    repository.approveRequest.mockResolvedValue(
      requestRow({
        requester_user_id: actor.id,
        status: 'APPROVED',
        approver_user_id: approver.id,
        download_token_hash: 'hashed-token',
        download_expires_at: new Date('2026-07-06T00:00:00.000Z'),
      }),
    );

    const result = await service.approveRequest('request-id', approver, { ip: '127.0.0.1' });
    const downloadToken = (result.data as { download_token?: unknown }).download_token;
    const approveInput = repository.approveRequest.mock.calls[0]?.[0];

    expect(downloadToken).toEqual(expect.any(String));
    expect(approveInput?.id).toBe('request-id');
    expect(approveInput?.approverUserId).toBe(approver.id);
    expect(typeof approveInput?.downloadTokenHash).toBe('string');
    expect(repository.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'APPROVE', actorUserId: approver.id }),
      expect.anything(),
    );
  });

  it('exports masked identifiers by default', async () => {
    const token = 'download-token';
    repository.claimDownload.mockResolvedValue(
      requestRow({
        status: 'APPROVED',
        requester_user_id: actor.id,
        approver_user_id: approver.id,
        approver_username: approver.username,
        download_token_hash: hashToken(token),
        include_full_national_id: false,
      }),
    );
    repository.countRequestStudents.mockResolvedValue(0);
    repository.listStudentsForExport.mockResolvedValue([studentRow]);

    const result = await service.download(token, { ip: null });

    expect(result.filename).toBe('pii-export-00000000.csv');
    expect(result.csv).toContain('export_id');
    expect(result.csv).toContain('•••••••••••••');
    expect(result.csv).not.toContain('1234567890123');
    expect(result.csv).toContain('••••••••');
    expect(repository.listStudentsForExport).toHaveBeenCalledWith(
      { school_ids: [10010002] },
      undefined,
    );
    expect(repository.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'DOWNLOAD', actorUserId: null }),
      expect.anything(),
    );
  });

  it('exports full national id only when the approved request allows it', async () => {
    const token = 'download-token';
    repository.claimDownload.mockResolvedValue(
      requestRow({
        status: 'APPROVED',
        download_token_hash: hashToken(token),
        include_full_national_id: true,
      }),
    );
    repository.countRequestStudents.mockResolvedValue(0);
    repository.listStudentsForExport.mockResolvedValue([studentRow]);

    const result = await service.download(token, { ip: null });

    expect(result.csv).toContain('1234567890123');
    expect(result.csv).toContain('เลขบัตรประชาชน');
  });

  it('downloads only persisted selected students for selected-student exports', async () => {
    const token = 'download-token';
    repository.claimDownload.mockResolvedValue(
      requestRow({
        status: 'APPROVED',
        download_token_hash: hashToken(token),
        include_full_national_id: false,
      }),
    );
    repository.countRequestStudents.mockResolvedValue(1);
    repository.listStudentsForExport.mockResolvedValue([studentRow]);

    await service.download(token, { ip: null });

    expect(repository.listStudentsForExport).toHaveBeenCalledWith(
      { school_ids: [10010002] },
      '00000000-0000-4000-8000-000000000001',
    );
  });

  it('returns gone for a used or expired download token', async () => {
    const token = 'download-token';
    repository.claimDownload.mockResolvedValue(null);
    repository.findRequestByTokenHash.mockResolvedValue(
      requestRow({ status: 'DOWNLOADED', download_token_hash: hashToken(token) }),
    );

    await expect(service.download(token, { ip: null })).rejects.toBeInstanceOf(GoneException);
  });
});
