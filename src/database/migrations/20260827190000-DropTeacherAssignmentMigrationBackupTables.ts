import type { MigrationInterface, QueryRunner } from 'typeorm';

const STALE_TABLES = [
  // `DeactivateOrphanedSubjectAssignments` (20260827170000) snapshot of the
  // rows it deactivated. `ReactivateHomeroomSubjectAssignments`
  // (20260827180000) already reversed the 441 โฮมรูม rows this table got
  // wrong; the other 16 are real pre-curriculum orphans nobody has asked to
  // restore. Owner asked not to carry a backup table for either.
  'orphaned_subject_assignment_deactivation_20260827_backup',
  // `BackfillCurriculumSubjectAssignments` (20260827130000) snapshot of the
  // assignment rows it inserted. The 3,519 rows it backfilled are now live,
  // in-use assignment data — reverting that migration in production would be
  // far more disruptive than losing its own rollback list.
  'curriculum_subject_assignment_backfill_20260827_backup',
];

/**
 * Drops the two migration-backup tables from the 2026-08-27 curriculum/
 * teacher-assignment cleanup, at the owner's request — same rationale as
 * `DropStaleDemoBackupTables`/`DropStaleMigrationBackupTables`: intentionally
 * not reversible, since both backups exist only to undo migrations nobody
 * intends to revert.
 */
export class DropTeacherAssignmentMigrationBackupTables20260827190000 implements MigrationInterface {
  name = 'DropTeacherAssignmentMigrationBackupTables20260827190000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of STALE_TABLES) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${table}`);
    }
  }

  /** Both backups held real, still-relevant rows; there is nothing to recreate on rollback. */
  public down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    return Promise.resolve();
  }
}
