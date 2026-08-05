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
      taskType: 'ATTENDANCE',
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
});
