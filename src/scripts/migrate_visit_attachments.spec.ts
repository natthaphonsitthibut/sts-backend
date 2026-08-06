import { assertSingleSubmissionUpdate } from './migrate-visit-attachments.util';

describe('migrateVisitAttachments', () => {
  it('accepts one structured UPDATE result from TypeORM', () => {
    expect(() =>
      assertSingleSubmissionUpdate('5', {
        rows: [{ id: '5' }],
        rowCount: 1,
      }),
    ).not.toThrow();
  });

  it('rejects an optimistic update that no longer matches the submission', () => {
    expect(() =>
      assertSingleSubmissionUpdate('5', {
        rows: [],
        rowCount: 0,
      }),
    ).toThrow('Submission 5 changed while migrating; no legacy file was deleted');
  });
});
