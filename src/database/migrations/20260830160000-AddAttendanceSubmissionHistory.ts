import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes a submitted attendance result replaceable without exposing a draft to
 * other readers. Each submit is atomic: current exceptions, the session
 * summary, immutable history, per-student changes, actor, and reason commit
 * together. `lock_version` rejects stale browser tabs.
 */
export class AddAttendanceSubmissionHistory20260830160000 implements MigrationInterface {
  name = 'AddAttendanceSubmissionHistory20260830160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        ADD COLUMN submission_number INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1
    `);
    await queryRunner.query(`
      UPDATE attendance_sessions
      SET submission_number = CASE
        WHEN submitted_at IS NULL THEN 0
        ELSE GREATEST(revision, 1)
      END
    `);
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        DROP CONSTRAINT chk_attendance_sessions_revision,
        DROP COLUMN revision,
        ADD CONSTRAINT chk_attendance_sessions_submission_number
          CHECK (submission_number >= 0),
        ADD CONSTRAINT chk_attendance_sessions_lock_version
          CHECK (lock_version > 0)
    `);
    await queryRunner.query(`
      CREATE TABLE attendance_submission_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL,
        school_id INTEGER NOT NULL,
        submission_number INTEGER NOT NULL,
        correction_reason VARCHAR(500),
        actor_user_id INTEGER,
        actor_teacher_membership_id BIGINT,
        source VARCHAR(30) NOT NULL,
        classroom_attendance_link_id UUID,
        submitted_at TIMESTAMPTZ NOT NULL,
        expected_roster_count INTEGER NOT NULL,
        exception_count INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_attendance_submission_history_session_number
          UNIQUE (session_id, submission_number),
        CONSTRAINT uq_attendance_submission_history_id_session
          UNIQUE (id, session_id),
        CONSTRAINT fk_attendance_submission_history_session_school
          FOREIGN KEY (session_id, school_id) REFERENCES attendance_sessions(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_submission_history_actor_user
          FOREIGN KEY (actor_user_id) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_submission_history_actor_membership_school
          FOREIGN KEY (actor_teacher_membership_id, school_id)
          REFERENCES school_teacher_memberships(id, school_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_submission_history_classroom_link
          FOREIGN KEY (classroom_attendance_link_id) REFERENCES classroom_attendance_links(id)
          ON DELETE SET NULL ON UPDATE CASCADE,
        CONSTRAINT chk_attendance_submission_history_number
          CHECK (submission_number > 0),
        CONSTRAINT chk_attendance_submission_history_reason
          CHECK (
            submission_number = 1
            OR (
              correction_reason IS NOT NULL
              AND length(btrim(correction_reason)) BETWEEN 3 AND 500
            )
          ),
        CONSTRAINT chk_attendance_submission_history_actor
          CHECK (num_nonnulls(actor_user_id, actor_teacher_membership_id) <= 1),
        CONSTRAINT chk_attendance_submission_history_source
          CHECK (source IN ('INTERNAL', 'CLASSROOM_LINK')),
        CONSTRAINT chk_attendance_submission_history_counts
          CHECK (
            expected_roster_count >= 0
            AND exception_count >= 0
            AND exception_count <= expected_roster_count
          )
      )
    `);
    await queryRunner.query(`
      INSERT INTO attendance_submission_history (
        session_id, school_id, submission_number, correction_reason,
        actor_user_id, actor_teacher_membership_id, source,
        classroom_attendance_link_id, submitted_at,
        expected_roster_count, exception_count
      )
      SELECT
        session.id, session.school_id, session.submission_number,
        CASE
          WHEN session.submission_number > 1 THEN COALESCE(
            NULLIF(btrim(session.correction_reason), ''),
            'ย้ายข้อมูลเดิม: ไม่มีเหตุผลที่บันทึกไว้'
          )
          ELSE NULL
        END,
        session.submitted_by,
        CASE WHEN session.submitted_by IS NULL
          THEN session.submitted_by_teacher_membership_id ELSE NULL END,
        CASE WHEN session.classroom_attendance_link_id IS NULL
          THEN 'INTERNAL' ELSE 'CLASSROOM_LINK' END,
        session.classroom_attendance_link_id,
        session.submitted_at,
        session.expected_roster_count,
        session.exception_count
      FROM attendance_sessions session
      WHERE session.submitted_at IS NOT NULL
        AND session.submission_number > 0
    `);
    await queryRunner.query(`
      CREATE TABLE attendance_submission_changes (
        submission_history_id UUID NOT NULL,
        session_id UUID NOT NULL,
        student_uuid UUID NOT NULL,
        previous_attendance_status_code SMALLINT NOT NULL,
        new_attendance_status_code SMALLINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_attendance_submission_changes
          PRIMARY KEY (submission_history_id, student_uuid),
        CONSTRAINT fk_attendance_submission_changes_history_session
          FOREIGN KEY (submission_history_id, session_id)
          REFERENCES attendance_submission_history(id, session_id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_submission_changes_roster
          FOREIGN KEY (session_id, student_uuid)
          REFERENCES attendance_session_roster(session_id, student_uuid)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_submission_changes_previous_status
          FOREIGN KEY (previous_attendance_status_code)
          REFERENCES attendance_record_statuses(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_submission_changes_new_status
          FOREIGN KEY (new_attendance_status_code)
          REFERENCES attendance_record_statuses(code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT chk_attendance_submission_changes_changed
          CHECK (previous_attendance_status_code <> new_attendance_status_code)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_attendance_submission_history_session_time
        ON attendance_submission_history (session_id, submitted_at DESC);
      CREATE INDEX idx_attendance_submission_changes_student_time
        ON attendance_submission_changes (student_uuid, created_at DESC)
    `);
    await queryRunner.query(`
      CREATE FUNCTION prevent_attendance_submission_history_mutation()
      RETURNS trigger AS $prevent_attendance_submission_history_mutation$
      BEGIN
        RAISE EXCEPTION 'attendance submission history is append-only';
      END;
      $prevent_attendance_submission_history_mutation$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_attendance_submission_changes_append_only
      BEFORE UPDATE OR DELETE ON attendance_submission_changes
      FOR EACH ROW EXECUTE FUNCTION prevent_attendance_submission_history_mutation();
    `);
    /*
     * The history keeps two pointers at rows that can outlive it — the actor's
     * user account and the link the register came through — and both are
     * declared `ON DELETE SET NULL`. A referential action *is* an UPDATE, so a
     * blanket append-only guard would refuse it and make deleting either parent
     * fail outright; `pii_access_events` hit exactly this and was relaxed the
     * same way in `AllowPiiAccessActorRelease20260828110000`.
     *
     * This allows that one write and nothing else: it must come from inside
     * another trigger (a referential action runs nested, an app statement runs
     * at depth 1), every other column must be byte-identical, and a pointer may
     * only go from set to NULL — never the other way, which would let someone
     * re-attribute a submitted register to a different person or link. DELETE
     * stays blocked outright: that a register was submitted never goes away,
     * only the pointer to a parent row that no longer exists.
     */
    await queryRunner.query(`
      CREATE FUNCTION release_attendance_submission_history_parents()
      RETURNS trigger AS $release_attendance_submission_history_parents$
      BEGIN
        IF TG_OP = 'UPDATE'
          AND pg_trigger_depth() > 1
          AND (to_jsonb(NEW) - 'actor_user_id' - 'classroom_attendance_link_id')
            = (to_jsonb(OLD) - 'actor_user_id' - 'classroom_attendance_link_id')
          AND (NEW.actor_user_id IS NULL OR NEW.actor_user_id = OLD.actor_user_id)
          AND (
            NEW.classroom_attendance_link_id IS NULL
            OR NEW.classroom_attendance_link_id = OLD.classroom_attendance_link_id
          )
        THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'attendance submission history is append-only';
      END;
      $release_attendance_submission_history_parents$ LANGUAGE plpgsql;

      CREATE TRIGGER trg_attendance_submission_history_append_only
      BEFORE UPDATE OR DELETE ON attendance_submission_history
      FOR EACH ROW EXECUTE FUNCTION release_attendance_submission_history_parents();
    `);
    await queryRunner.query(`
      ALTER TABLE attendance_submission_history ENABLE ROW LEVEL SECURITY;
      ALTER TABLE attendance_submission_changes ENABLE ROW LEVEL SECURITY;
      DO $revoke_attendance_submission_history$
      DECLARE role_name TEXT;
      BEGIN
        FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
            EXECUTE format(
              'REVOKE ALL PRIVILEGES ON TABLE attendance_submission_history, attendance_submission_changes FROM %I',
              role_name
            );
          END IF;
        END LOOP;
      END $revoke_attendance_submission_history$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE attendance_submission_changes`);
    await queryRunner.query(`DROP TABLE attendance_submission_history`);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS release_attendance_submission_history_parents`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS prevent_attendance_submission_history_mutation`,
    );
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        ADD COLUMN revision INTEGER NOT NULL DEFAULT 1
    `);
    await queryRunner.query(`
      UPDATE attendance_sessions
      SET revision = GREATEST(submission_number, 1)
    `);
    await queryRunner.query(`
      ALTER TABLE attendance_sessions
        DROP CONSTRAINT chk_attendance_sessions_lock_version,
        DROP CONSTRAINT chk_attendance_sessions_submission_number,
        DROP COLUMN lock_version,
        DROP COLUMN submission_number,
        ADD CONSTRAINT chk_attendance_sessions_revision CHECK (revision > 0)
    `);
  }
}
