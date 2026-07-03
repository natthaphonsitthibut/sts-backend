import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ListImportQuarantineDto,
  ResolveImportQuarantineDto,
  RetryImportQuarantineDto,
} from './imports.dto';

describe('import quarantine DTOs', () => {
  it('rejects unsupported pagination values', () => {
    const dto = plainToInstance(ListImportQuarantineDto, { page: 0, limit: 100 });

    expect(validateSync(dto)).toHaveLength(2);
  });

  it('accepts known filter values', () => {
    const dto = plainToInstance(ListImportQuarantineDto, {
      status: 'PENDING',
      reasonCode: 'IDENTIFIER_CONFLICT',
      search: 'สมชาย',
    });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects an unknown reason code and an oversized search term', () => {
    const dto = plainToInstance(ListImportQuarantineDto, {
      reasonCode: 'NOT_A_REASON',
      search: 'x'.repeat(121),
    });

    expect(validateSync(dto)).toHaveLength(2);
  });

  it('accepts a valid opaque candidate key', () => {
    const dto = plainToInstance(ResolveImportQuarantineDto, {
      action: 'RESOLVE',
      candidateKey: 'a'.repeat(64),
    });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a malformed candidate key and action', () => {
    const dto = plainToInstance(ResolveImportQuarantineDto, {
      action: 'MERGE',
      candidateKey: '0',
    });

    expect(validateSync(dto)).toHaveLength(2);
  });

  it('requires a non-empty rejection note', () => {
    const missing = plainToInstance(ResolveImportQuarantineDto, { action: 'REJECT' });
    const valid = plainToInstance(ResolveImportQuarantineDto, {
      action: 'REJECT',
      note: 'ข้อมูลไม่ถูกต้อง',
    });

    expect(validateSync(missing)).toHaveLength(1);
    expect(validateSync(valid)).toHaveLength(0);
  });

  it('validates retry filters without accepting pagination or status fields', () => {
    const valid = plainToInstance(RetryImportQuarantineDto, {
      reasonCode: 'GRADE_NOT_FOUND',
      schoolId: '1001',
    });
    const invalid = plainToInstance(RetryImportQuarantineDto, {
      reasonCode: 'NOT_A_REASON',
      schoolId: 0,
    });

    expect(validateSync(valid)).toHaveLength(0);
    expect(validateSync(invalid)).toHaveLength(2);
  });
});
