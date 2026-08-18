import type { MigrationInterface, QueryRunner } from 'typeorm';

const STALE_TABLES = [
  // `NormalizeDemoDataProvenance` (20260724130000) snapshot of demo attendance
  // provenance before the fix. `CompactDemoSubjectAttendance` (20260826090000)
  // already truncated these down to only the retained showcase rows, which
  // settled at zero — nothing outstanding to restore.
  'demo_provenance_attendance_backup_20260724',
  'demo_provenance_attendance_session_backup_20260724',
  'demo_provenance_submission_actor_backup_20260724',
  // `StructureStudentNotifications` / `RequireStudentNotificationReasons`
  // (20260731) snapshot of rows their own migration would have rejected.
  // Nothing was rejected, so these never held a row.
  'notification_structure_rejected_backup_20260731',
  'notification_reason_rejected_backup_20260731',
];

/**
 * Clears empty migration-backup tables that settled at zero rows and are
 * only ever read by the (already-applied) migration that created them. None
 * of the demo data they describe is real, so — same as
 * `CompactDemoSubjectAttendance` — this is intentionally not reversible.
 */
export class DropStaleDemoBackupTables20260827140000 implements MigrationInterface {
  name = 'DropStaleDemoBackupTables20260827140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of STALE_TABLES) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }

  /** These backups held nothing; there is nothing to recreate on rollback. */
  public down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    return Promise.resolve();
  }
}
