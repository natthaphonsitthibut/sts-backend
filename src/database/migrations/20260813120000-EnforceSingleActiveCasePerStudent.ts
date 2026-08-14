import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A student may have historical cases, but only one active workflow at a time.
 * Retire duplicate active records while retaining their audit/history rows, then
 * enforce that invariant for every write path, including concurrent requests.
 */
export class EnforceSingleActiveCasePerStudent20260813120000 implements MigrationInterface {
  name = 'EnforceSingleActiveCasePerStudent20260813120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS case_lifecycle_remediation_case_backup (
        remediation_code VARCHAR(64) NOT NULL,
        case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE ON UPDATE CASCADE,
        previous_deleted_at TIMESTAMPTZ,
        previous_deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        previous_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        previous_reason_flagged TEXT,
        PRIMARY KEY (remediation_code, case_id)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS case_lifecycle_remediation_task_backup (
        remediation_code VARCHAR(64) NOT NULL,
        task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
        previous_deleted_at TIMESTAMPTZ,
        previous_deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        previous_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        PRIMARY KEY (remediation_code, task_id)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS case_lifecycle_remediation_link_backup (
        remediation_code VARCHAR(64) NOT NULL,
        link_id UUID NOT NULL REFERENCES task_links(id) ON DELETE CASCADE ON UPDATE CASCADE,
        previous_deleted_at TIMESTAMPTZ,
        previous_deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        previous_updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        PRIMARY KEY (remediation_code, link_id)
      )
    `);

    await queryRunner.query(`
      CREATE TEMP TABLE duplicate_active_case_ids ON COMMIT DROP AS
      WITH ranked_active_cases AS (
        SELECT
          c.id,
          ROW_NUMBER() OVER (
            PARTITION BY c.student_uuid
            ORDER BY
              CASE c.status
                WHEN 'PENDING_REVIEW' THEN 4
                WHEN 'IN_PROGRESS' THEN 3
                WHEN 'STUDENT_NOT_FOUND' THEN 2
                WHEN 'OPEN' THEN 1
                ELSE 0
              END DESC,
              c.created_at DESC,
              c.id DESC
          ) AS active_case_rank
        FROM cases c
        WHERE c.student_uuid IS NOT NULL
          AND c.deleted_at IS NULL
          AND c.status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
      )
      SELECT id FROM ranked_active_cases WHERE active_case_rank > 1
    `);

    await queryRunner.query(`
      INSERT INTO case_lifecycle_remediation_case_backup (
        remediation_code, case_id, previous_deleted_at, previous_deleted_by,
        previous_updated_by, previous_reason_flagged
      )
      SELECT 'DUPLICATE_ACTIVE_CASE', c.id, c.deleted_at, c.deleted_by, c.updated_by, c.reason_flagged
      FROM cases c
      JOIN duplicate_active_case_ids duplicate_case ON duplicate_case.id = c.id
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO case_lifecycle_remediation_task_backup (
        remediation_code, task_id, previous_deleted_at, previous_deleted_by, previous_updated_by
      )
      SELECT 'DUPLICATE_ACTIVE_CASE', task.id, task.deleted_at, task.deleted_by, task.updated_by
      FROM tasks task
      JOIN duplicate_active_case_ids duplicate_case ON duplicate_case.id = task.case_id
      WHERE task.deleted_at IS NULL
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO case_lifecycle_remediation_link_backup (
        remediation_code, link_id, previous_deleted_at, previous_deleted_by, previous_updated_by
      )
      SELECT 'DUPLICATE_ACTIVE_CASE', link.id, link.deleted_at, link.deleted_by, link.updated_by
      FROM task_links link
      JOIN tasks task ON task.id = link.task_id
      JOIN duplicate_active_case_ids duplicate_case ON duplicate_case.id = task.case_id
      WHERE link.deleted_at IS NULL
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`
      UPDATE task_links link
      SET deleted_at = NOW(),
          deleted_by = COALESCE(link.updated_by, link.created_by),
          updated_by = COALESCE(link.updated_by, link.created_by)
      FROM tasks task
      JOIN duplicate_active_case_ids duplicate_case ON duplicate_case.id = task.case_id
      WHERE link.task_id = task.id AND link.deleted_at IS NULL
    `);
    await queryRunner.query(`
      UPDATE tasks task
      SET deleted_at = NOW(),
          deleted_by = COALESCE(task.updated_by, task.created_by),
          updated_by = COALESCE(task.updated_by, task.created_by)
      FROM duplicate_active_case_ids duplicate_case
      WHERE task.case_id = duplicate_case.id AND task.deleted_at IS NULL
    `);
    await queryRunner.query(`
      UPDATE cases duplicate_case
      SET
        deleted_at = NOW(),
        deleted_by = COALESCE(duplicate_case.updated_by, duplicate_case.created_by),
        updated_by = COALESCE(duplicate_case.updated_by, duplicate_case.created_by)
      FROM duplicate_active_case_ids duplicate_id
      WHERE duplicate_case.id = duplicate_id.id
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_cases_active_student_uuid
        ON cases(student_uuid)
        WHERE student_uuid IS NOT NULL
          AND deleted_at IS NULL
          AND status IN ('OPEN', 'IN_PROGRESS', 'PENDING_REVIEW', 'STUDENT_NOT_FOUND')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_cases_active_student_uuid`);
    await queryRunner.query(`
      UPDATE cases c
      SET deleted_at = backup.previous_deleted_at,
          deleted_by = backup.previous_deleted_by,
          updated_by = backup.previous_updated_by,
          reason_flagged = backup.previous_reason_flagged
      FROM case_lifecycle_remediation_case_backup backup
      WHERE backup.remediation_code = 'DUPLICATE_ACTIVE_CASE' AND backup.case_id = c.id
    `);
    await queryRunner.query(`
      UPDATE tasks task
      SET deleted_at = backup.previous_deleted_at,
          deleted_by = backup.previous_deleted_by,
          updated_by = backup.previous_updated_by
      FROM case_lifecycle_remediation_task_backup backup
      WHERE backup.remediation_code = 'DUPLICATE_ACTIVE_CASE' AND backup.task_id = task.id
    `);
    await queryRunner.query(`
      UPDATE task_links link
      SET deleted_at = backup.previous_deleted_at,
          deleted_by = backup.previous_deleted_by,
          updated_by = backup.previous_updated_by
      FROM case_lifecycle_remediation_link_backup backup
      WHERE backup.remediation_code = 'DUPLICATE_ACTIVE_CASE' AND backup.link_id = link.id
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS case_lifecycle_remediation_link_backup`);
    await queryRunner.query(`DROP TABLE IF EXISTS case_lifecycle_remediation_task_backup`);
    await queryRunner.query(`DROP TABLE IF EXISTS case_lifecycle_remediation_case_backup`);
  }
}
