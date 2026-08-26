import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GetAuditLogQueryDto } from './audit-log.dto';

function validateQuery(input: Record<string, unknown>) {
  return validateSync(plainToInstance(GetAuditLogQueryDto, input));
}

describe('GetAuditLogQueryDto', () => {
  it('accepts valid target and task filters', () => {
    const errors = validateQuery({
      domain: 'tasks',
      taskType: 'VISIT',
      targetType: 'task_link',
      targetId: 'link-1',
      page: '1',
      limit: '20',
    });

    expect(errors).toHaveLength(0);
  });

  it('rejects invalid domain, date, task type and case id', () => {
    const errors = validateQuery({
      domain: 'unknown',
      dateFrom: '04-07-2026',
      taskType: 'OTHER',
      caseId: '0',
      limit: '999',
    });
    const invalidProperties = errors.map((error) => error.property);

    expect(invalidProperties).toEqual(
      expect.arrayContaining(['domain', 'dateFrom', 'taskType', 'caseId', 'limit']),
    );
  });

  it('accepts real calendar dates', () => {
    expect(
      validateQuery({ domain: 'users', dateFrom: '2026-02-28', dateTo: '2026-03-01' }),
    ).toHaveLength(0);
    expect(validateQuery({ domain: 'users', dateFrom: '2024-02-29' })).toHaveLength(0);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2025-02-29'])(
    'rejects the non-existent date %s before it reaches the ::date cast',
    (value) => {
      expect(validateQuery({ domain: 'users', dateFrom: value })).toHaveLength(1);
      expect(validateQuery({ domain: 'users', dateTo: value })).toHaveLength(1);
    },
  );

  it('rejects date filters that are not plain ISO dates', () => {
    expect(validateQuery({ domain: 'users', dateFrom: '2026-02-28T10:00:00Z' })).toHaveLength(1);
    expect(validateQuery({ domain: 'users', dateFrom: '28/02/2026' })).toHaveLength(1);
  });
});
