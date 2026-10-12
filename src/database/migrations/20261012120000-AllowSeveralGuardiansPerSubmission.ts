import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Who looks after the student is now a set, not one answer (owner,
 * 2026-10-12): the visitor ticks บิดา and มารดา — or มารดา and ตา / ยาย —
 * instead of hunting for a combined choice, so the combined `บิดาและมารดา`
 * option retires and its answers become the two rows it always meant.
 *
 * The set lives in a junction table shaped like the residence-environment one.
 * `ไม่มีผู้ปกครอง` is flagged exclusive the way `ปกติ / ไม่มีปัจจัยเสี่ยง` is: it
 * cannot sit beside a guardian. The detail text stays on the submission; the
 * rule that it needs an `อื่น ๆ` pick can no longer be a column CHECK and is
 * enforced by the service that writes both.
 */
export class AllowSeveralGuardiansPerSubmission20261012120000 implements MigrationInterface {
  name = 'AllowSeveralGuardiansPerSubmission20261012120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE guardian_type_options
        ADD COLUMN is_exclusive BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await queryRunner.query(`
      UPDATE guardian_type_options SET is_exclusive = TRUE WHERE code = 'NO_GUARDIAN'
    `);

    await queryRunner.query(`
      CREATE TABLE task_submission_guardian_types (
        task_submission_id INTEGER NOT NULL
          REFERENCES task_submissions(id) ON DELETE CASCADE ON UPDATE CASCADE,
        guardian_type_code VARCHAR(40) NOT NULL
          REFERENCES guardian_type_options(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        PRIMARY KEY (task_submission_id, guardian_type_code)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_task_submission_guardian_types_code
        ON task_submission_guardian_types (guardian_type_code)
    `);

    await queryRunner.query(`
      INSERT INTO task_submission_guardian_types (
        task_submission_id, guardian_type_code, created_at
      )
      SELECT submission.id, picked.code, COALESCE(submission.submitted_at, now())
      FROM task_submissions submission
      CROSS JOIN LATERAL unnest(
        CASE submission.guardian_type_code
          WHEN 'FATHER_AND_MOTHER' THEN ARRAY['FATHER', 'MOTHER']::varchar[]
          ELSE ARRAY[submission.guardian_type_code]::varchar[]
        END
      ) AS picked(code)
      WHERE submission.guardian_type_code IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP CONSTRAINT IF EXISTS chk_task_submissions_guardian_type_detail,
        DROP CONSTRAINT IF EXISTS fk_task_submissions_guardian_type,
        DROP COLUMN guardian_type_code,
        ADD CONSTRAINT chk_task_submissions_guardian_type_detail CHECK (
          guardian_type_detail IS NULL OR length(btrim(guardian_type_detail)) > 0
        )
    `);
    await queryRunner.query(`
      DELETE FROM guardian_type_options WHERE code = 'FATHER_AND_MOTHER'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Freeze report writes before checking what the old column can represent.
    // Take locks in the same order as report insertion (submission, then picks).
    await queryRunner.query(`
      LOCK TABLE task_submissions, task_submission_guardian_types IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM task_submission_guardian_types
          GROUP BY task_submission_id
          HAVING count(*) > 1 AND NOT (
            count(*) = 2
            AND bool_and(guardian_type_code IN ('FATHER', 'MOTHER'))
          )
        ) OR EXISTS (
          SELECT 1 FROM task_submissions submission
          WHERE submission.guardian_type_detail IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM task_submission_guardian_types link
              WHERE link.task_submission_id = submission.id
            )
        ) THEN
          RAISE EXCEPTION 'refusing rollback: guardian answers cannot fit the legacy column';
        END IF;
      END $$
    `);
    await queryRunner.query(`
      INSERT INTO guardian_type_options (code, label_th, sort_order, requires_detail)
      VALUES ('FATHER_AND_MOTHER', 'บิดาและมารดา', 30, FALSE)
      ON CONFLICT (code) DO NOTHING
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP CONSTRAINT IF EXISTS chk_task_submissions_guardian_type_detail,
        ADD COLUMN guardian_type_code VARCHAR(40),
        ADD CONSTRAINT fk_task_submissions_guardian_type
          FOREIGN KEY (guardian_type_code)
          REFERENCES guardian_type_options(code)
          ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    // Only single answers and the exact father/mother pair passed the guard.
    await queryRunner.query(`
      UPDATE task_submissions submission
      SET guardian_type_code = folded.code
      FROM (
        SELECT link.task_submission_id,
               CASE
                 WHEN bool_or(link.guardian_type_code = 'FATHER')
                  AND bool_or(link.guardian_type_code = 'MOTHER')
                 THEN 'FATHER_AND_MOTHER'
                 ELSE (array_agg(link.guardian_type_code ORDER BY option.sort_order, option.code))[1]
               END AS code
        FROM task_submission_guardian_types link
        JOIN guardian_type_options option ON option.code = link.guardian_type_code
        GROUP BY link.task_submission_id
      ) folded
      WHERE folded.task_submission_id = submission.id
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        ADD CONSTRAINT chk_task_submissions_guardian_type_detail CHECK (
          guardian_type_detail IS NULL
          OR (guardian_type_code IS NOT NULL AND length(btrim(guardian_type_detail)) > 0)
        )
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS task_submission_guardian_types`);
    await queryRunner.query(`ALTER TABLE guardian_type_options DROP COLUMN IF EXISTS is_exclusive`);
  }
}
