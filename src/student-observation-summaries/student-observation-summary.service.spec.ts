import { ServiceUnavailableException } from '@nestjs/common';
import type { AuditLogService } from '../audit-log/audit-log.service';
import {
  DisabledObservationSummaryAdapter,
  type ObservationSummaryAdapter,
} from './observation-summary.adapter';
import type { StudentObservationSummaryRepository } from './student-observation-summary.repository';
import { StudentObservationSummaryService } from './student-observation-summary.service';

const actor = {
  id: 7,
  username: 'director',
  roles: ['DIRECTOR'],
  permissions: ['students'],
  data_scope: { school_ids: [101] },
} as never;
const source = {
  observation_id: '11',
  observation_revision: 2,
  dimension_code: 'LEARNING',
  concern_level: 'WATCH',
  comment: 'ไม่ส่งงาน',
  observed_at: '2026-07-14T00:00:00Z',
  tag_codes: ['MISSING_ASSIGNMENTS'],
};
const output = {
  providerCode: 'FAKE',
  modelCode: 'fake-model',
  promptVersion: 'p1',
  summaryText: 'มีข้อสังเกตด้านการเรียน',
  themes: ['การเรียน'],
  trends: [],
  agreements: [],
  conflictingEvidence: [],
  citations: [{ observationId: '11', revision: 2 }],
};

function setup(adapter: ObservationSummaryAdapter) {
  const summaryRow = {
    id: 'summary-1',
    student_uuid: 'student-1',
    school_id: 101,
    input_fingerprint: 'a'.repeat(64),
    provider_code: 'FAKE',
    model_code: 'fake-model',
    prompt_version: 'p1',
    summary_text: output.summaryText,
    themes: output.themes,
    trends: [],
    agreements: [],
    conflicting_evidence: [],
    source_observation_count: 1,
    is_stale: false,
    review_state: 'PENDING_REVIEW' as const,
    reviewed_by_user_id: null,
    reviewer_display_name: null,
    review_note: null,
    reviewed_at: null,
    generated_at: '2026-07-15T00:00:00Z',
    created_at: '2026-07-15T00:00:00Z',
    updated_at: '2026-07-15T00:00:00Z',
    citations: [{ observationId: '11', observationRevision: 2, order: 0 }],
  };
  const repository = {
    findEnrollment: jest.fn().mockResolvedValue({ student_uuid: 'student-1', school_id: 101 }),
    isSchoolInScope: jest.fn().mockResolvedValue(true),
    listSources: jest.fn().mockResolvedValue([source]),
    findByFingerprint: jest.fn().mockResolvedValue(null),
    createSummary: jest.fn().mockResolvedValue(summaryRow),
    withTransaction: jest.fn(
      async (operation: (runner: never) => Promise<unknown>) => await operation({} as never),
    ),
    findLatest: jest.fn().mockResolvedValue(null),
    markStale: jest.fn(),
    review: jest.fn(),
  };
  const audit = { record: jest.fn(), recordAtomic: jest.fn() };
  return {
    repository,
    audit,
    summaryRow,
    service: new StudentObservationSummaryService(
      repository as unknown as StudentObservationSummaryRepository,
      audit as unknown as AuditLogService,
      adapter,
    ),
  };
}

describe('StudentObservationSummaryService', () => {
  it('fails closed before reading sources outside current school scope', async () => {
    const adapter = { generate: jest.fn() };
    const { repository, service } = setup(adapter);
    repository.isSchoolInScope.mockResolvedValueOnce(false);
    await expect(service.generate('student-1', {}, actor)).rejects.toThrow('ไม่พบนักเรียน');
    expect(repository.listSources).not.toHaveBeenCalled();
    expect(adapter.generate).not.toHaveBeenCalled();
  });

  it('keeps production generation disabled with a sanitized 503', async () => {
    const { service } = setup(new DisabledObservationSummaryAdapter());
    await expect(service.generate('student-1', {}, actor)).rejects.toEqual(
      expect.objectContaining({ status: 503, message: 'ระบบสรุปอัตโนมัติยังไม่พร้อมใช้งาน' }),
    );
  });

  it('rejects empty, timeout, and conflicting adapter results without persistence', async () => {
    for (const fake of [
      { generate: jest.fn().mockRejectedValue(new Error('provider timeout with private input')) },
      { generate: jest.fn().mockResolvedValue({ ...output, summaryText: '' }) },
      {
        generate: jest
          .fn()
          .mockResolvedValue({ ...output, citations: [{ observationId: '999', revision: 1 }] }),
      },
    ]) {
      const { repository, service } = setup(fake);
      await expect(service.generate('student-1', {}, actor)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(repository.createSummary).not.toHaveBeenCalled();
    }
  });

  it('persists only validated server-scoped citations and never mutates risk or cases', async () => {
    const fake = { generate: jest.fn().mockResolvedValue(output) };
    const { repository, audit, service } = setup(fake);
    await expect(
      service.generate('student-1', { sourceObservationIds: ['11'] }, actor),
    ).resolves.toMatchObject({ reused: false, data: { aiGenerated: true } });
    expect(repository.listSources).toHaveBeenCalledWith('student-1', 101, ['11']);
    expect(repository.createSummary).toHaveBeenCalledWith(
      expect.objectContaining({ studentUuid: 'student-1', schoolId: 101 }),
      [source],
      expect.anything(),
    );
    expect(JSON.stringify(audit.recordAtomic.mock.calls)).not.toContain('ไม่ส่งงาน');
    expect(repository).not.toHaveProperty('updateRisk');
    expect(repository).not.toHaveProperty('createCase');
  });

  it('reuses the same input fingerprint without calling the adapter again', async () => {
    const fake = { generate: jest.fn() };
    const { repository, service, summaryRow } = setup(fake);
    repository.findByFingerprint.mockResolvedValueOnce(summaryRow);
    await expect(service.generate('student-1', {}, actor)).resolves.toMatchObject({ reused: true });
    expect(fake.generate).not.toHaveBeenCalled();
  });

  it('GET returns a non-blocking fallback without invoking the adapter', async () => {
    const fake = { generate: jest.fn() };
    const { service } = setup(fake);
    await expect(service.get('student-1', actor)).resolves.toEqual({
      data: null,
      generation: { available: false, reason: 'DISABLED_OR_NOT_GENERATED' },
    });
    expect(fake.generate).not.toHaveBeenCalled();
  });

  it('marks a stored summary stale when current source content no longer matches its fingerprint', async () => {
    const fake = { generate: jest.fn() };
    const { repository, service, summaryRow } = setup(fake);
    repository.findLatest.mockResolvedValueOnce(summaryRow);

    await expect(service.get('student-1', actor)).resolves.toMatchObject({
      data: { id: 'summary-1', isStale: true },
    });
    expect(repository.markStale).toHaveBeenCalledWith('summary-1');
    expect(fake.generate).not.toHaveBeenCalled();
  });
});
