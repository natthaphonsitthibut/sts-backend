import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A case no longer ends at the follow-up review: the reviewer can now send it
 * into an assistance round (assign someone → record what help was given →
 * review again) before closing or referring it.
 *
 * That is modelled as a second dimension (`workflow_phase_code`) rather than new
 * status codes, exactly like `completion_outcome_code` splits `RESOLVED`. The
 * five workflow statuses stay five — every case filter, summary counter and
 * notification in the system counts on that — while `OPEN`, `IN_PROGRESS` and
 * `PENDING_REVIEW` gain a phase so `รอมอบหมายติดตาม` and
 * `รอมอบหมายให้ความช่วยเหลือ` are distinguishable.
 *
 * Which review action is offered in which phase is data (`available_phase_code`)
 * rather than an `if` in the service, so "assistance review only offers ปิดเคส
 * and ส่งต่อหน่วยงาน" is enforced by the same table that lists the buttons.
 */
export class AddCaseAssistancePhase20260817090000 implements MigrationInterface {
  name = 'AddCaseAssistancePhase20260817090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE case_workflow_phases (
        code VARCHAR(24) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_case_workflow_phases_label CHECK (length(btrim(label_th)) > 0),
        CONSTRAINT chk_case_workflow_phases_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      INSERT INTO case_workflow_phases (code, label_th, sort_order)
      VALUES
        ('FOLLOW_UP', 'ติดตาม', 10),
        ('ASSISTANCE', 'ให้ความช่วยเหลือ', 20)
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_case_workflow_phases_set_updated_at
      BEFORE UPDATE ON case_workflow_phases
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    // Every existing case is a follow-up case, so backfill before locking NOT NULL.
    await queryRunner.query(`
      ALTER TABLE cases ADD COLUMN workflow_phase_code VARCHAR(24)
    `);
    await queryRunner.query(`UPDATE cases SET workflow_phase_code = 'FOLLOW_UP'`);
    await queryRunner.query(`
      ALTER TABLE cases
        ALTER COLUMN workflow_phase_code SET DEFAULT 'FOLLOW_UP',
        ALTER COLUMN workflow_phase_code SET NOT NULL,
        ADD CONSTRAINT fk_cases_workflow_phase
          FOREIGN KEY (workflow_phase_code) REFERENCES case_workflow_phases(code)
          ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX idx_cases_workflow_phase ON cases(workflow_phase_code)
      WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE case_review_actions
        ADD COLUMN available_phase_code VARCHAR(24),
        ADD COLUMN target_workflow_phase_code VARCHAR(24),
        ADD CONSTRAINT fk_case_review_actions_available_phase
          FOREIGN KEY (available_phase_code) REFERENCES case_workflow_phases(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT fk_case_review_actions_target_phase
          FOREIGN KEY (target_workflow_phase_code) REFERENCES case_workflow_phases(code)
          ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    // NULL `available_phase_code` = offered in every phase, which is what ปิดเคส
    // and ส่งต่อหน่วยงาน need; ASSIST is the only phase-restricted action.
    await queryRunner.query(`
      INSERT INTO case_review_actions (
        code, label_th, target_case_status_code, completion_outcome_code,
        requires_resolution_outcome, required_permission_code, sort_order,
        available_phase_code, target_workflow_phase_code
      ) VALUES (
        'ASSIST', 'ให้ความช่วยเหลือ', 'OPEN', NULL,
        FALSE, 'review-cases', 5,
        'FOLLOW_UP', 'ASSISTANCE'
      )
    `);

    // The 202603 baseline shipped an `assistance_measures (id, label)` stub for
    // this feature that was never wired to anything. It is empty and nothing
    // references it, so replace it with the real lookup rather than inventing a
    // second table with a near-identical name.
    await queryRunner.query(`
      DO $assistance_measures_stub$
      BEGIN
        IF EXISTS (SELECT 1 FROM assistance_measures) THEN
          RAISE EXCEPTION 'assistance_measures stub is not empty; migrate its rows before replacing it';
        END IF;
      END $assistance_measures_stub$
    `);
    await queryRunner.query(`DROP TABLE assistance_measures`);
    await queryRunner.query(`
      CREATE TABLE assistance_measures (
        code VARCHAR(40) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        sort_order SMALLINT NOT NULL,
        requires_detail BOOLEAN NOT NULL DEFAULT FALSE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_assistance_measures_label CHECK (length(btrim(label_th)) > 0),
        CONSTRAINT chk_assistance_measures_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      INSERT INTO assistance_measures (code, label_th, sort_order, requires_detail)
      VALUES
        ('SCHOLARSHIP', 'ให้ทุนการศึกษา', 10, FALSE),
        ('LEARNING_SUPPLIES', 'สนับสนุนอุปกรณ์การเรียน', 20, FALSE),
        ('STRESS_ASSESSMENT', 'ประเมินความเครียด/อารมณ์', 30, FALSE),
        ('PSYCHIATRIST_CONSULT', 'ปรึกษาจิตแพทย์', 40, FALSE),
        ('OTHER', 'อื่น ๆ (ระบุในช่อง)', 90, TRUE)
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_assistance_measures_set_updated_at
      BEFORE UPDATE ON assistance_measures
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);

    // `tasks.task_type` was a CHECK-list enum, which cannot grow without a
    // migration touching the constraint every time a work type is added.
    await queryRunner.query(`
      CREATE TABLE task_types (
        code VARCHAR(24) PRIMARY KEY,
        label_th VARCHAR(120) NOT NULL,
        sort_order SMALLINT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        deleted_at TIMESTAMPTZ,
        deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_task_types_label CHECK (length(btrim(label_th)) > 0),
        CONSTRAINT chk_task_types_sort_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`
      INSERT INTO task_types (code, label_th, sort_order)
      VALUES
        ('VISIT', 'ลงพื้นที่ติดตาม', 10),
        ('ASSIST', 'ให้ความช่วยเหลือ', 20),
        ('LOGIN', 'ลิงก์เข้าใช้งาน', 30)
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_task_types_set_updated_at
      BEFORE UPDATE ON task_types
      FOR EACH ROW EXECUTE FUNCTION set_updated_at()
    `);
    await queryRunner.query(`
      ALTER TABLE tasks
        DROP CONSTRAINT IF EXISTS chk_tasks_task_type,
        ADD CONSTRAINT fk_tasks_task_type
          FOREIGN KEY (task_type) REFERENCES task_types(code)
          ON DELETE RESTRICT ON UPDATE CASCADE
    `);

    // One assistance round can combine measures (a scholarship AND supplies),
    // so the picked set is a junction, not a column.
    await queryRunner.query(`
      ALTER TABLE tasks ADD COLUMN assistance_measure_detail VARCHAR(200)
    `);
    await queryRunner.query(`
      ALTER TABLE tasks
        ADD CONSTRAINT chk_tasks_assistance_measure_detail
          CHECK (assistance_measure_detail IS NULL OR length(btrim(assistance_measure_detail)) > 0)
    `);
    await queryRunner.query(`
      CREATE TABLE task_assistance_measures (
        task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE ON UPDATE CASCADE,
        assistance_measure_code VARCHAR(40) NOT NULL
          REFERENCES assistance_measures(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        PRIMARY KEY (task_id, assistance_measure_code)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_task_assistance_measures_measure
        ON task_assistance_measures(assistance_measure_code)
    `);

    await queryRunner.query(`
      ALTER TABLE task_submissions
        ADD COLUMN assisted_at TIMESTAMPTZ,
        ADD COLUMN assistance_detail TEXT,
        ADD CONSTRAINT chk_task_submissions_assistance_detail
          CHECK (
            assistance_detail IS NULL
            OR (length(btrim(assistance_detail)) > 0 AND length(assistance_detail) <= 2000)
          )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP CONSTRAINT IF EXISTS chk_task_submissions_assistance_detail,
        DROP COLUMN IF EXISTS assistance_detail,
        DROP COLUMN IF EXISTS assisted_at
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS task_assistance_measures`);
    await queryRunner.query(`
      ALTER TABLE tasks
        DROP CONSTRAINT IF EXISTS chk_tasks_assistance_measure_detail,
        DROP COLUMN IF EXISTS assistance_measure_detail
    `);
    // Assistance tasks only exist because of this migration; drop them before
    // restoring the VISIT/LOGIN-only constraint so the CHECK can be satisfied.
    await queryRunner.query(`DELETE FROM tasks WHERE task_type = 'ASSIST'`);
    await queryRunner.query(`
      ALTER TABLE tasks
        DROP CONSTRAINT IF EXISTS fk_tasks_task_type,
        ADD CONSTRAINT chk_tasks_task_type
          CHECK (task_type = ANY (ARRAY['VISIT'::text, 'LOGIN'::text]))
    `);
    await queryRunner.query(`DROP TRIGGER IF EXISTS trg_task_types_set_updated_at ON task_types`);
    await queryRunner.query(`DROP TABLE IF EXISTS task_types`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_assistance_measures_set_updated_at ON assistance_measures`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS assistance_measures`);
    await queryRunner.query(`
      CREATE TABLE assistance_measures (id SERIAL PRIMARY KEY, label TEXT NOT NULL UNIQUE)
    `);
    await queryRunner.query(`DELETE FROM case_review_actions WHERE code = 'ASSIST'`);
    await queryRunner.query(`
      ALTER TABLE case_review_actions
        DROP CONSTRAINT IF EXISTS fk_case_review_actions_available_phase,
        DROP CONSTRAINT IF EXISTS fk_case_review_actions_target_phase,
        DROP COLUMN IF EXISTS available_phase_code,
        DROP COLUMN IF EXISTS target_workflow_phase_code
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cases_workflow_phase`);
    await queryRunner.query(`
      ALTER TABLE cases
        DROP CONSTRAINT IF EXISTS fk_cases_workflow_phase,
        DROP COLUMN IF EXISTS workflow_phase_code
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS trg_case_workflow_phases_set_updated_at ON case_workflow_phases`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS case_workflow_phases`);
  }
}
