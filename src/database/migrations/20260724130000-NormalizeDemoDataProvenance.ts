import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeDemoDataProvenance20260724130000 implements MigrationInterface {
  name = 'NormalizeDemoDataProvenance20260724130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE demo_provenance_user_origin_backup_20260724 (
        user_id INTEGER PRIMARY KEY,
        previous_data_origin_code VARCHAR(32) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_demo_provenance_user_origin_backup_user
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_user_origin_backup_origin
          FOREIGN KEY (previous_data_origin_code) REFERENCES data_record_origins(code)
          ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE demo_provenance_case_review_backup_20260724 (
        review_id UUID PRIMARY KEY,
        previous_source_actor_user_id INTEGER,
        backfilled_actor_user_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_demo_provenance_review_backup_review
          FOREIGN KEY (review_id) REFERENCES case_reviews(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_review_backup_previous_actor
          FOREIGN KEY (previous_source_actor_user_id) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_review_backup_actor
          FOREIGN KEY (backfilled_actor_user_id) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE demo_provenance_task_actor_backup_20260724 (
        task_id UUID PRIMARY KEY,
        previous_created_by INTEGER,
        previous_updated_by INTEGER,
        backfilled_actor_user_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_demo_provenance_task_backup_task
          FOREIGN KEY (task_id) REFERENCES tasks(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_task_backup_previous_creator
          FOREIGN KEY (previous_created_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_task_backup_previous_updater
          FOREIGN KEY (previous_updated_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_task_backup_actor
          FOREIGN KEY (backfilled_actor_user_id) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE demo_provenance_submission_actor_backup_20260724 (
        submission_id INTEGER PRIMARY KEY,
        previous_created_by INTEGER,
        previous_updated_by INTEGER,
        backfilled_actor_user_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_demo_provenance_submission_backup_submission
          FOREIGN KEY (submission_id) REFERENCES task_submissions(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_submission_backup_previous_creator
          FOREIGN KEY (previous_created_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_submission_backup_previous_updater
          FOREIGN KEY (previous_updated_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_submission_backup_actor
          FOREIGN KEY (backfilled_actor_user_id) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE demo_provenance_attendance_session_backup_20260724 (
        session_id UUID PRIMARY KEY,
        previous_created_by INTEGER,
        previous_updated_by INTEGER,
        previous_submitted_by INTEGER,
        backfilled_actor_user_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_demo_provenance_session_backup_session
          FOREIGN KEY (session_id) REFERENCES attendance_sessions(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_session_backup_previous_creator
          FOREIGN KEY (previous_created_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_session_backup_previous_updater
          FOREIGN KEY (previous_updated_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_session_backup_previous_submitter
          FOREIGN KEY (previous_submitted_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_session_backup_actor
          FOREIGN KEY (backfilled_actor_user_id) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE demo_provenance_attendance_backup_20260724 (
        attendance_id INTEGER PRIMARY KEY,
        previous_recorded_by VARCHAR(255),
        previous_created_by INTEGER,
        previous_updated_by INTEGER,
        backfilled_actor_user_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT fk_demo_provenance_attendance_backup_attendance
          FOREIGN KEY (attendance_id) REFERENCES attendance("AttendanceID")
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_attendance_backup_previous_creator
          FOREIGN KEY (previous_created_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_attendance_backup_previous_updater
          FOREIGN KEY (previous_updated_by) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_demo_provenance_attendance_backup_actor
          FOREIGN KEY (backfilled_actor_user_id) REFERENCES users(id)
          ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(`
      INSERT INTO demo_provenance_case_review_backup_20260724 (
        review_id,
        previous_source_actor_user_id,
        backfilled_actor_user_id
      )
      SELECT
        review.id,
        review.source_actor_user_id,
        MIN(actor.id)::int
      FROM case_reviews review
      JOIN users actor
        ON actor.username = review.reviewed_by
        OR trim(concat_ws(' ', actor."FirstName", actor."LastName")) = trim(review.reviewed_by)
      WHERE review.source_actor_user_id IS NULL
      GROUP BY review.id, review.source_actor_user_id
      HAVING COUNT(DISTINCT actor.id) = 1
      ON CONFLICT (review_id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE case_reviews review
      SET source_actor_user_id = backup.backfilled_actor_user_id
      FROM demo_provenance_case_review_backup_20260724 backup
      WHERE review.id = backup.review_id
        AND review.source_actor_user_id IS NULL
    `);
    await queryRunner.query(`
      INSERT INTO demo_provenance_user_origin_backup_20260724 (
        user_id,
        previous_data_origin_code
      )
      SELECT id, data_origin_code
      FROM users
      WHERE data_origin_code <> 'AUTOMATED_TEST'
        AND (
          username ~* '(^|[-_])(seed|smoke|test|fixture)([-_0-9]|$)'
          OR lower(split_part(COALESCE(email, ''), '@', 2)) = 'example.invalid'
          OR EXISTS (
            SELECT 1
            FROM (
              VALUES
                ('chanwit.j', 'seed-teacher-002'),
                ('kittichai.d', 'seed-admin-district-001'),
                ('maneerat.d', 'seed-admin-province-001'),
                ('narongsak.k', 'seed-teacher-003'),
                ('orathai.b', 'seed-admin-001'),
                ('phatcharin.d', 'seed-admin-subdistrict-001'),
                ('preeya.p', 'seed-director-001'),
                ('suphawadi.w', 'seed-teacher-001'),
                ('thanakorn.p', 'seed-executive-001'),
                ('worapon.d', 'seed-admin-school-001')
            ) AS persona(username, legacy_person_id)
            WHERE users.username = persona.username
              AND users."PersonID_Onec" = persona.legacy_person_id
              AND lower(split_part(users.email, '@', 2)) = 'sts-demo.ac.th'
          )
        )
      ON CONFLICT (user_id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE users target
      SET data_origin_code = 'AUTOMATED_TEST',
          updated_at = now()
      FROM demo_provenance_user_origin_backup_20260724 backup
      WHERE target.id = backup.user_id
        AND target.data_origin_code = backup.previous_data_origin_code
    `);
    await queryRunner.query(`
      INSERT INTO demo_provenance_task_actor_backup_20260724 (
        task_id,
        previous_created_by,
        previous_updated_by,
        backfilled_actor_user_id
      )
      SELECT
        task.id,
        task.created_by,
        task.updated_by,
        MIN(link.created_by)::int
      FROM tasks task
      JOIN task_links link ON link.task_id = task.id
      WHERE (task.created_by IS NULL OR task.updated_by IS NULL)
        AND lower(split_part(link.assigned_to_email, '@', 2)) = 'sts-demo.ac.th'
        AND link.created_by IS NOT NULL
      GROUP BY task.id, task.created_by, task.updated_by
      HAVING COUNT(DISTINCT link.created_by) = 1
      ON CONFLICT (task_id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE tasks task
      SET created_by = COALESCE(task.created_by, backup.backfilled_actor_user_id),
          updated_by = COALESCE(task.updated_by, backup.backfilled_actor_user_id)
      FROM demo_provenance_task_actor_backup_20260724 backup
      WHERE task.id = backup.task_id
    `);
    await queryRunner.query(`
      INSERT INTO demo_provenance_submission_actor_backup_20260724 (
        submission_id,
        previous_created_by,
        previous_updated_by,
        backfilled_actor_user_id
      )
      SELECT
        submission.id,
        submission.created_by,
        submission.updated_by,
        MIN(actor.id)::int
      FROM task_submissions submission
      JOIN task_links link ON link.id = submission.task_link_id
      JOIN users actor ON lower(actor.email) = lower(link.assigned_to_email)
      WHERE (submission.created_by IS NULL OR submission.updated_by IS NULL)
        AND lower(split_part(link.assigned_to_email, '@', 2)) = 'sts-demo.ac.th'
      GROUP BY submission.id, submission.created_by, submission.updated_by
      HAVING COUNT(DISTINCT actor.id) = 1
      ON CONFLICT (submission_id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE task_submissions submission
      SET created_by = COALESCE(submission.created_by, backup.backfilled_actor_user_id),
          updated_by = COALESCE(submission.updated_by, backup.backfilled_actor_user_id)
      FROM demo_provenance_submission_actor_backup_20260724 backup
      WHERE submission.id = backup.submission_id
    `);
    await queryRunner.query(`
      UPDATE users target
      SET data_origin_code = 'DEMO',
          "PersonID_Onec" = mapping.synthetic_person_id,
          updated_at = now()
      FROM (
        VALUES
          ('chanwit.j', 'seed-teacher-002', '9900010000017'),
          ('kittichai.d', 'seed-admin-district-001', '9900010000025'),
          ('maneerat.d', 'seed-admin-province-001', '9900010000033'),
          ('narongsak.k', 'seed-teacher-003', '9900010000041'),
          ('orathai.b', 'seed-admin-001', '9900010000050'),
          ('phatcharin.d', 'seed-admin-subdistrict-001', '9900010000068'),
          ('preeya.p', 'seed-director-001', '9900010000076'),
          ('suphawadi.w', 'seed-teacher-001', '9900010000084'),
          ('thanakorn.p', 'seed-executive-001', '9900010000092'),
          ('worapon.d', 'seed-admin-school-001', '9900010000106')
      ) AS mapping(username, legacy_person_id, synthetic_person_id)
      WHERE target.username = mapping.username
        AND target."PersonID_Onec" = mapping.legacy_person_id
        AND lower(split_part(target.email, '@', 2)) = 'sts-demo.ac.th'
    `);
    await queryRunner.query(`
      INSERT INTO demo_provenance_attendance_session_backup_20260724 (
        session_id,
        previous_created_by,
        previous_updated_by,
        previous_submitted_by,
        backfilled_actor_user_id
      )
      SELECT
        session.id,
        session.created_by,
        session.updated_by,
        session.submitted_by,
        MIN(teacher.id)::int
      FROM attendance_sessions session
      JOIN attendance record ON record.session_id = session.id
      JOIN school_classrooms classroom
        ON classroom.school_term_id = session.school_term_id
       AND classroom.school_id = session.school_id
       AND classroom.grade_level_id = session.grade_level_id
       AND classroom.legacy_room_number = session.room_id
       AND classroom.classroom_status = 'ACTIVE'
       AND classroom.deleted_at IS NULL
      JOIN classroom_teacher_assignments assignment
        ON assignment.classroom_id = classroom.id
       AND assignment.school_id = classroom.school_id
       AND assignment.assignment_kind = 'HOMEROOM'
       AND assignment.assignment_status = 'ACTIVE'
       AND assignment.deleted_at IS NULL
      JOIN school_teacher_memberships membership
        ON membership.id = assignment.teacher_membership_id
       AND membership.school_id = assignment.school_id
       AND membership.membership_status = 'ACTIVE'
       AND membership.deleted_at IS NULL
      JOIN users teacher
        ON teacher.id = membership.teacher_user_id
       AND teacher.status = 'ACTIVE'
       AND teacher.data_origin_code = 'DEMO'
      WHERE (
          session.created_by IS NULL
          OR session.updated_by IS NULL
          OR session.submitted_by IS NULL
        )
        AND record."RecordedBy" ~* '(seed|smoke|test|fixture)'
      GROUP BY
        session.id,
        session.created_by,
        session.updated_by,
        session.submitted_by
      HAVING COUNT(DISTINCT teacher.id) = 1
      ON CONFLICT (session_id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE attendance_sessions session
      SET created_by = COALESCE(session.created_by, backup.backfilled_actor_user_id),
          updated_by = COALESCE(session.updated_by, backup.backfilled_actor_user_id),
          submitted_by = COALESCE(session.submitted_by, backup.backfilled_actor_user_id)
      FROM demo_provenance_attendance_session_backup_20260724 backup
      WHERE session.id = backup.session_id
    `);
    await queryRunner.query(`
      INSERT INTO demo_provenance_attendance_backup_20260724 (
        attendance_id,
        previous_recorded_by,
        previous_created_by,
        previous_updated_by,
        backfilled_actor_user_id
      )
      SELECT
        record."AttendanceID",
        record."RecordedBy",
        record.created_by,
        record.updated_by,
        session.submitted_by
      FROM attendance record
      JOIN attendance_sessions session ON session.id = record.session_id
      JOIN users actor
        ON actor.id = session.submitted_by
       AND actor.data_origin_code <> 'AUTOMATED_TEST'
      WHERE record."RecordedBy" ~* '(seed|smoke|test|fixture)'
      ON CONFLICT (attendance_id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE attendance record
      SET "RecordedBy" = actor.username,
          created_by = COALESCE(record.created_by, backup.backfilled_actor_user_id),
          updated_by = COALESCE(record.updated_by, backup.backfilled_actor_user_id)
      FROM demo_provenance_attendance_backup_20260724 backup
      JOIN users actor ON actor.id = backup.backfilled_actor_user_id
      WHERE record."AttendanceID" = backup.attendance_id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users target
      SET "PersonID_Onec" = mapping.legacy_person_id,
          updated_at = now()
      FROM (
        VALUES
          ('chanwit.j', 'seed-teacher-002', '9900010000017'),
          ('kittichai.d', 'seed-admin-district-001', '9900010000025'),
          ('maneerat.d', 'seed-admin-province-001', '9900010000033'),
          ('narongsak.k', 'seed-teacher-003', '9900010000041'),
          ('orathai.b', 'seed-admin-001', '9900010000050'),
          ('phatcharin.d', 'seed-admin-subdistrict-001', '9900010000068'),
          ('preeya.p', 'seed-director-001', '9900010000076'),
          ('suphawadi.w', 'seed-teacher-001', '9900010000084'),
          ('thanakorn.p', 'seed-executive-001', '9900010000092'),
          ('worapon.d', 'seed-admin-school-001', '9900010000106')
      ) AS mapping(username, legacy_person_id, synthetic_person_id)
      WHERE target.username = mapping.username
        AND target."PersonID_Onec" = mapping.synthetic_person_id
        AND target.data_origin_code = 'DEMO'
    `);
    await queryRunner.query(`
      UPDATE attendance record
      SET "RecordedBy" = CASE
            WHEN record."RecordedBy" = actor.username
            THEN backup.previous_recorded_by
            ELSE record."RecordedBy"
          END,
          created_by = CASE
            WHEN backup.previous_created_by IS NULL
              AND record.created_by = backup.backfilled_actor_user_id
            THEN NULL
            ELSE record.created_by
          END,
          updated_by = CASE
            WHEN backup.previous_updated_by IS NULL
              AND record.updated_by = backup.backfilled_actor_user_id
            THEN NULL
            ELSE record.updated_by
          END
      FROM demo_provenance_attendance_backup_20260724 backup
      JOIN users actor ON actor.id = backup.backfilled_actor_user_id
      WHERE record."AttendanceID" = backup.attendance_id
    `);
    await queryRunner.query(`
      UPDATE attendance_sessions session
      SET created_by = CASE
            WHEN backup.previous_created_by IS NULL
              AND session.created_by = backup.backfilled_actor_user_id
            THEN NULL
            ELSE session.created_by
          END,
          updated_by = CASE
            WHEN backup.previous_updated_by IS NULL
              AND session.updated_by = backup.backfilled_actor_user_id
            THEN NULL
            ELSE session.updated_by
          END,
          submitted_by = CASE
            WHEN backup.previous_submitted_by IS NULL
              AND session.submitted_by = backup.backfilled_actor_user_id
            THEN NULL
            ELSE session.submitted_by
          END
      FROM demo_provenance_attendance_session_backup_20260724 backup
      WHERE session.id = backup.session_id
    `);
    await queryRunner.query(`
      UPDATE task_submissions submission
      SET created_by = CASE
            WHEN backup.previous_created_by IS NULL
              AND submission.created_by = backup.backfilled_actor_user_id
            THEN NULL
            ELSE submission.created_by
          END,
          updated_by = CASE
            WHEN backup.previous_updated_by IS NULL
              AND submission.updated_by = backup.backfilled_actor_user_id
            THEN NULL
            ELSE submission.updated_by
          END
      FROM demo_provenance_submission_actor_backup_20260724 backup
      WHERE submission.id = backup.submission_id
    `);
    await queryRunner.query(`
      UPDATE tasks task
      SET created_by = CASE
            WHEN backup.previous_created_by IS NULL
              AND task.created_by = backup.backfilled_actor_user_id
            THEN NULL
            ELSE task.created_by
          END,
          updated_by = CASE
            WHEN backup.previous_updated_by IS NULL
              AND task.updated_by = backup.backfilled_actor_user_id
            THEN NULL
            ELSE task.updated_by
          END
      FROM demo_provenance_task_actor_backup_20260724 backup
      WHERE task.id = backup.task_id
    `);
    await queryRunner.query(`
      UPDATE case_reviews review
      SET source_actor_user_id = backup.previous_source_actor_user_id
      FROM demo_provenance_case_review_backup_20260724 backup
      WHERE review.id = backup.review_id
        AND review.source_actor_user_id = backup.backfilled_actor_user_id
    `);
    await queryRunner.query(`
      UPDATE users target
      SET data_origin_code = backup.previous_data_origin_code,
          updated_at = now()
      FROM demo_provenance_user_origin_backup_20260724 backup
      WHERE target.id = backup.user_id
        AND target.data_origin_code IN ('AUTOMATED_TEST', 'DEMO')
    `);
    await queryRunner.query(`DROP TABLE demo_provenance_attendance_backup_20260724`);
    await queryRunner.query(`DROP TABLE demo_provenance_attendance_session_backup_20260724`);
    await queryRunner.query(`DROP TABLE demo_provenance_submission_actor_backup_20260724`);
    await queryRunner.query(`DROP TABLE demo_provenance_task_actor_backup_20260724`);
    await queryRunner.query(`DROP TABLE demo_provenance_case_review_backup_20260724`);
    await queryRunner.query(`DROP TABLE demo_provenance_user_origin_backup_20260724`);
  }
}
