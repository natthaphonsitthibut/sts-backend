import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop snapshot tables that earlier migrations kept so their `down()` could
 * restore the previous values.
 *
 * Every migration behind these snapshots has been live and verified for weeks, so
 * none will be reverted. Several snapshots also hold copies of personal data (the
 * Burapha address backup, the risk-profile split), which should not linger in a
 * table nobody reads. The rows were exported to the workspace archive
 * (`data/backups/migration-backup-tables-*-20260925.*`) before this ran.
 *
 * Kept on purpose: the snapshots from 2026-09-22 and later, whose migrations are
 * still within their rollback window, and `user_role_scope_migration_backup`,
 * which `pnpm roles:verify-migration-parity` still reads.
 *
 * Irreversible, and it also blocks reverting past this point, so the older
 * `down()` methods that read these tables can no longer be reached by accident.
 */
const DROPPED_BACKUP_TABLES = [
  'attendance_calendar_reason_20260827_backup',
  'case_lifecycle_remediation_case_backup',
  'case_student_uuid_backfill_20260702_backup',
  'case_tracking_role_permission_backup_20260720',
  'case_tracking_user_permission_backup_20260720',
  'demo_provenance_case_review_backup_20260724',
  'demo_provenance_task_actor_backup_20260724',
  'demo_provenance_user_origin_backup_20260724',
  // created only where the 2026-08-27 repair found rows, so absent on some databases
  'exception_attendance_scope_repair_20260827_backup',
  'home_dashboard_category_reconcile_20260824_backup',
  'kindergarten_grade_level_seed_20260716_backup',
  'master_data_reconcile_backup_20260824',
  'migration_20260827313400_burapha_student_address_backup',
  'migration_20260827313400_burapha_user_scope_backup',
  'permission_default_reset_backups',
  'permission_page_collapse_backup_20260821',
  'risk_profile_absence_metric_split_backup_20260814',
  'risk_profile_absence_setting_backup_20260814',
  'role_default_alignment_backup_20260825',
  'role_definition_migration_backup',
  'schema_id_uuid_standardization_backup',
  'settings_permission_scope_backup_20260827',
  'student_teacher_permission_split_backup_20260827',
  'task_link_role_scope_migration_backup',
  'teacher_membership_scope_backfill_20260716_backup',
  'user_scope_backfill_20260702_backup',
] as const;

export class DropArchivedMigrationBackups20260925150000 implements MigrationInterface {
  name = 'DropArchivedMigrationBackups20260925150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of DROPPED_BACKUP_TABLES) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }

  public down(): Promise<void> {
    return Promise.reject(
      new Error(
        'DropArchivedMigrationBackups20260925150000 is intentionally irreversible. ' +
          'Restore rows from data/backups/migration-backup-tables-*-20260925.* if a snapshot is ever needed.',
      ),
    );
  }
}
