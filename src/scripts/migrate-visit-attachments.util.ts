import type { SqlQueryResult } from '../database/sql-query';

export function assertSingleSubmissionUpdate(
  submissionId: string,
  result: SqlQueryResult<{ id: string }>,
): void {
  if (result.rowCount !== 1 || result.rows.length !== 1 || result.rows[0]?.id !== submissionId) {
    throw new Error(
      `Submission ${submissionId} changed while migrating; no legacy file was deleted`,
    );
  }
}
