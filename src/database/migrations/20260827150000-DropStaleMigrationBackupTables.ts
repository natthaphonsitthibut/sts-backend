import type { MigrationInterface, QueryRunner } from 'typeorm';

const STALE_TABLES = [
  // `AlignCaseTrackingWorkflow` (20260720120000) snapshot of report-up rows
  // and case_tracking statuses it was about to replace. Nothing existed to
  // snapshot, so these settled at zero.
  'case_tracking_report_up_backup_20260720',
  'case_tracking_status_backup_20260720',
  // `AlignGeneratedSchoolRolePermissions` (20260807181000) snapshot of
  // permission rows before regenerating them. Nothing was overwritten.
  'school_role_permission_alignment_backups_20260807',
  // `RevokeStudentHomePermission` (20260719130000) snapshot of the revoked
  // grants. No school had granted it, so nothing was backed up.
  'student_home_permission_migration_backups',
  // `BackfillExplicitGlobalScope` (20260702150000) tracker of the rows it
  // inserted, mirroring the pattern this session's own backfill migrations
  // use. Nothing needed backfilling on this database.
  'task_link_scope_backfill_20260702_backup',
  // `MaterializeLegacyUserPermissions` (20260807180000) snapshot of the
  // permission rows it materialized. Nothing existed yet to snapshot.
  'user_permission_materialization_backups_20260807',
  // Shared log table across the four case-lifecycle remediation migrations
  // (20260813120000-20260813150000), one `remediation_code` per migration.
  // None of the four found a case needing remediation, so this never held a
  // row for any of them.
  'case_lifecycle_remediation_link_backup',
  'case_lifecycle_remediation_task_backup',
];

/**
 * Clears more empty migration-backup tables that settled at zero rows and
 * are only ever read by the (already-applied) migrations that created them.
 * Same rationale as `DropStaleDemoBackupTables`: intentionally not
 * reversible, since there is nothing in any of these tables to restore.
 */
export class DropStaleMigrationBackupTables20260827150000 implements MigrationInterface {
  name = 'DropStaleMigrationBackupTables20260827150000';

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
