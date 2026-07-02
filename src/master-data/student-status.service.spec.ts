import { ConflictException, NotFoundException } from '@nestjs/common';
import { StudentStatusService } from './student-status.service';
import type { StudentStatusRow } from './student-status.types';

const ACTIVE_ROW: StudentStatusRow = {
  code: 10,
  label_th: 'กำลังศึกษา',
  category: 'ACTIVE',
  is_active_for_login: true,
  is_terminal: false,
  requires_followup: false,
  is_enabled: true,
  sort_order: 10,
  source_system: 'ONEC',
  usage_count: 5001,
};

describe('StudentStatusService', () => {
  const actor = {
    id: 1,
    username: 'admin',
    roles: ['ADMIN'],
    permissions: ['settings'],
  };

  function setup() {
    const queryRunner = { query: jest.fn() };
    const repository = {
      list: jest.fn(),
      findByCode: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      withTransaction: jest.fn(async (operation: (runner: unknown) => Promise<unknown>) =>
        operation(queryRunner),
      ),
    };
    const auditLog = { recordAtomic: jest.fn() };
    return {
      service: new StudentStatusService(repository as never, auditLog as never),
      repository,
      auditLog,
      queryRunner,
    };
  }

  it('returns an explicit paginated response shape', async () => {
    const { service, repository } = setup();
    repository.list.mockResolvedValue({ rows: [ACTIVE_ROW], totalCount: 1 });

    await expect(service.list({ page: 1, limit: 20 })).resolves.toEqual({
      data: [
        {
          code: 10,
          labelTh: 'กำลังศึกษา',
          category: 'ACTIVE',
          isActiveForLogin: true,
          isTerminal: false,
          requiresFollowup: false,
          isEnabled: true,
          sortOrder: 10,
          sourceSystem: 'ONEC',
          usageCount: 5001,
        },
      ],
      meta: { page: 1, limit: 20, totalCount: 1, totalPages: 1 },
    });
  });

  it('updates policy metadata without creating or mutating a case', async () => {
    const { service, repository, auditLog, queryRunner } = setup();
    repository.findByCode
      .mockResolvedValueOnce(ACTIVE_ROW)
      .mockResolvedValueOnce({ ...ACTIVE_ROW, requires_followup: true });

    await service.update(actor, 10, { requiresFollowup: true });

    expect(repository.update).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ requiresFollowup: true, actorId: 1 }),
      queryRunner,
    );
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: 'student_status',
        metadata: { op: 'update', changedFields: ['requiresFollowup'] },
      }),
      queryRunner,
    );
  });

  it('fails closed when updating an unknown status code', async () => {
    const { service, repository } = setup();
    repository.findByCode.mockResolvedValue(null);

    await expect(service.update(actor, 999, { isEnabled: false })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('maps duplicate status codes to a conflict response', async () => {
    const { service, repository } = setup();
    repository.withTransaction.mockRejectedValue({ code: '23505' });

    await expect(
      service.create(actor, {
        code: 10,
        labelTh: 'กำลังศึกษา',
        category: 'ACTIVE',
        isActiveForLogin: true,
        isTerminal: false,
        requiresFollowup: false,
        isEnabled: true,
        sortOrder: 10,
        sourceSystem: 'ONEC',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
