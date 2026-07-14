import { resolveExecutiveReportingPolicy } from './executive-reporting.policy';
import { ExecutiveReportingModule } from './executive-reporting.module';

describe('resolveExecutiveReportingPolicy', () => {
  it('uses an explicit owner-approved minimum', () => {
    expect(
      resolveExecutiveReportingPolicy({ environment: 'production', minimumCellSize: 10 }),
    ).toEqual({ minimumCellSize: 10 });
  });

  it('uses the conservative fallback only outside production', () => {
    expect(resolveExecutiveReportingPolicy({ environment: 'test' })).toEqual({
      minimumCellSize: 5,
    });
  });

  it('fails closed when production has no approved minimum', () => {
    expect(() => resolveExecutiveReportingPolicy({ environment: 'production' })).toThrow(
      'must be explicitly configured',
    );
    expect(() => ExecutiveReportingModule.register({ environment: 'production' })).toThrow(
      'must be explicitly configured',
    );
  });
});
