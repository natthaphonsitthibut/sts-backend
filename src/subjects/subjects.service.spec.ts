import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../audit-log/audit-log.service';
import { SubjectsRepository } from './subjects.repository';
import { SubjectsService } from './subjects.service';
import type { SubjectRow } from './subjects.types';

describe('SubjectsService', () => {
  let service: SubjectsService;
  let repository: jest.Mocked<
    Pick<SubjectsRepository, 'list' | 'findById' | 'create' | 'update' | 'withTransaction'>
  >;
  let auditLog: jest.Mocked<Pick<AuditLogService, 'recordAtomic'>>;

  const actor = {
    id: 3,
    username: 'admin1',
    roles: ['ADMIN'],
    permissions: ['manage-timetable'],
    data_scope: { global: true },
  };

  function subjectRow(overrides: Partial<SubjectRow> = {}): SubjectRow {
    return {
      id: 1,
      code: 'MATH101',
      name_th: 'คณิตศาสตร์',
      is_active: true,
      created_at: new Date('2026-07-07T00:00:00Z'),
      updated_at: new Date('2026-07-07T00:00:00Z'),
      ...overrides,
    };
  }

  beforeEach(() => {
    repository = {
      list: jest.fn().mockResolvedValue({ rows: [subjectRow()], totalCount: 1 }),
      findById: jest.fn().mockResolvedValue(subjectRow()),
      create: jest.fn().mockResolvedValue(subjectRow()),
      update: jest.fn().mockResolvedValue(subjectRow({ name_th: 'คณิตศาสตร์ (แก้ไข)' })),
      withTransaction: jest.fn((operation) => operation({} as never)),
    };
    auditLog = { recordAtomic: jest.fn().mockResolvedValue(undefined) };
    service = new SubjectsService(
      repository as unknown as SubjectsRepository,
      auditLog as unknown as AuditLogService,
    );
  });

  it('creates a subject and audits SUBJECT_CREATE', async () => {
    const result = await service.create(actor, { code: 'MATH101', nameTh: 'คณิตศาสตร์' });

    expect(result.data.code).toBe('MATH101');
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUBJECT_CREATE' }),
      expect.anything(),
    );
  });

  it('maps a unique-code violation to ConflictException', async () => {
    repository.create.mockRejectedValue({ code: '23505' });

    await expect(
      service.create(actor, { code: 'MATH101', nameTh: 'คณิตศาสตร์' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects updating a subject that does not exist', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.update(actor, 999, { nameTh: 'x' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates a subject and audits SUBJECT_UPDATE', async () => {
    const result = await service.update(actor, 1, { nameTh: 'คณิตศาสตร์ (แก้ไข)' });

    expect(result.data.name_th).toBe('คณิตศาสตร์ (แก้ไข)');
    expect(auditLog.recordAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUBJECT_UPDATE' }),
      expect.anything(),
    );
  });
});
