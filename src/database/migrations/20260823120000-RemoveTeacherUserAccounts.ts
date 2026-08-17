import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Contract step of the teacher-identity move started in 20260823090000.
 *
 * A teacher is a row in `teachers`. Teachers do not sign in — they reach the
 * system through an access link — so the 445 `users` rows carrying `role =
 * 'TEACHER'` are login accounts nobody has ever logged into, and every column
 * that reached a teacher through one of them was an indirection with no payoff.
 *
 * 20260823090000 added and backfilled the direct pointers
 * (`task_links.assigned_teacher_id`, `attendance.recorded_by_teacher_id`) and
 * moved the readers onto them. This migration removes what is left:
 *
 *   1. `classroom_student_comments` gains `authored_by_teacher_id` — the last
 *      place a teacher's authorship was recorded only as a user id, and the one
 *      with content worth keeping (65 of 67 comments were written by teachers).
 *   2. `student_observations.author_user_id` and
 *      `student_observation_revisions.changed_by_user_id` become nullable. A
 *      teacher-access observation identifies its author through
 *      `author_teacher_membership_id` / `source_teacher_access_grant_id`; with
 *      no teacher accounts left, requiring a user id there would make that
 *      write path impossible rather than safe.
 *   3. The legacy pointers come out: `school_teacher_memberships.teacher_user_id`,
 *      `task_links.assigned_teacher_user_id`, `teachers.linked_user_id` and
 *      `timetable_slots.teacher_user_id` (superseded by `teacher_membership_id`
 *      in the timetable rework; one row still used it).
 *   4. The accounts and the `TEACHER` role are deleted.
 *
 * On the temporary indexes: `users` is the target of hundreds of foreign keys.
 * Creating an index for every one exhausted production storage, so only large
 * unindexed child tables that actually reference a TEACHER account are indexed.
 * Small tables are cheaper to scan; permanent attendance audit-FK indexes come
 * from 20260821180000.
 *
 * On audit/PII history: their immutable triggers refuse the `ON DELETE SET NULL`
 * update requested by their own actor foreign keys. The guards are suspended
 * only around the account DELETE so the actor reference can become NULL; the
 * history rows themselves are retained.
 *
 * `down()` restores the schema — columns, constraints and the role definition —
 * so the previous code runs again. It cannot restore the deleted login accounts,
 * but their immutable audit/PII history remains available with a null actor id.
 */
export class RemoveTeacherUserAccounts20260823120000 implements MigrationInterface {
  name = 'RemoveTeacherUserAccounts20260823120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Comment authorship moves onto the teacher row.
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        ADD COLUMN IF NOT EXISTS authored_by_teacher_id BIGINT
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        ADD CONSTRAINT fk_classroom_student_comments_teacher
        FOREIGN KEY (authored_by_teacher_id) REFERENCES teachers(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_classroom_student_comments_teacher
        ON classroom_student_comments(authored_by_teacher_id)
        WHERE authored_by_teacher_id IS NOT NULL
    `);
    await queryRunner.query(`
      UPDATE classroom_student_comments comment
      SET authored_by_teacher_id = teacher.id
      FROM teachers teacher
      WHERE teacher.linked_user_id = comment.authored_by_user_id
        AND teacher.deleted_at IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        ALTER COLUMN authored_by_user_id DROP NOT NULL
    `);
    await queryRunner.query(`
      UPDATE classroom_student_comments
      SET authored_by_user_id = NULL
      WHERE authored_by_teacher_id IS NOT NULL
    `);

    // A comment whose author is a teacher account we are about to delete but
    // which found no teacher row would silently lose its author. Stop instead.
    const orphanComments = (await queryRunner.query(`
      SELECT COUNT(*)::text AS count
      FROM classroom_student_comments comment
      JOIN users author ON author.id = comment.authored_by_user_id
      WHERE author.role = 'TEACHER'
    `)) as Array<{ count: string }>;
    if (Number(orphanComments[0]?.count ?? 0) > 0) {
      throw new Error(
        `RemoveTeacherUserAccounts: ${orphanComments[0].count} classroom_student_comments rows ` +
          'are authored by a teacher account with no matching teachers row. ' +
          'Link those teachers before running this migration.',
      );
    }
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        ADD CONSTRAINT chk_classroom_student_comments_author
        CHECK (num_nonnulls(authored_by_user_id, authored_by_teacher_id) = 1)
    `);

    // 2. A teacher-access observation is authored by a membership, not a login.
    await queryRunner.query(`
      ALTER TABLE student_observations ALTER COLUMN author_user_id DROP NOT NULL
    `);
    await queryRunner.query(`
      UPDATE student_observations
      SET author_user_id = NULL
      WHERE author_kind = 'TEACHER_ACCESS'
    `);
    await queryRunner.query(`
      ALTER TABLE student_observations
        ADD CONSTRAINT chk_student_observations_author_user
        CHECK (
          (author_kind = 'USER' AND author_user_id IS NOT NULL)
          OR (author_kind = 'TEACHER_ACCESS' AND author_user_id IS NULL)
        )
    `);
    // Preserve observations written by a retired teacher account. Their author
    // name becomes the immutable snapshot once the login row is removed.
    await queryRunner.query(`
      ALTER TABLE student_observations
        DROP CONSTRAINT IF EXISTS chk_student_observations_task_link_context,
        DROP CONSTRAINT IF EXISTS chk_student_observations_author_user
    `);
    await queryRunner.query(`
      UPDATE student_observations observation
      SET observer_display_name = COALESCE(
            NULLIF(TRIM(CONCAT_WS(' ', author."FirstName", author."LastName")), ''),
            author.username
          ),
          author_user_id = NULL
      FROM users author
      WHERE author.id = observation.author_user_id
        AND observation.author_kind = 'USER'
        AND author.role = 'TEACHER'
    `);
    await queryRunner.query(`
      ALTER TABLE student_observations
        ADD CONSTRAINT chk_student_observations_task_link_context
        CHECK (
          (
            source_task_link_id IS NULL
            AND source_timetable_slot_id IS NULL
            AND (
              observer_display_name IS NULL
              OR (author_kind = 'USER' AND author_user_id IS NULL)
            )
          )
          OR (
            author_kind = 'USER'
            AND source_task_link_id IS NOT NULL
            AND source_teacher_access_grant_id IS NULL
            AND author_teacher_membership_id IS NULL
            AND source_assignment_id IS NULL
            AND observer_display_name IS NOT NULL
          )
        )
    `);
    await queryRunner.query(`
      ALTER TABLE student_observations
        ADD CONSTRAINT chk_student_observations_author_user
        CHECK (
          (author_kind = 'USER' AND (author_user_id IS NOT NULL OR observer_display_name IS NOT NULL))
          OR (author_kind = 'TEACHER_ACCESS' AND author_user_id IS NULL)
        )
    `);
    await queryRunner.query(`
      ALTER TABLE student_observation_revisions
        ADD COLUMN changed_by_display_name VARCHAR(200)
    `);
    await queryRunner.query(`
      UPDATE student_observation_revisions revision
      SET changed_by_display_name = COALESCE(
            NULLIF(TRIM(CONCAT_WS(' ', author."FirstName", author."LastName")), ''),
            author.username
          )
      FROM users author
      WHERE author.id = revision.changed_by_user_id
        AND author.role = 'TEACHER'
    `);
    await queryRunner.query(`
      ALTER TABLE student_observation_revisions ALTER COLUMN changed_by_user_id DROP NOT NULL
    `);
    await queryRunner.query(`
      UPDATE student_observation_revisions
      SET changed_by_user_id = NULL
      WHERE changed_by_user_id IN (SELECT id FROM users WHERE role = 'TEACHER')
    `);
    await queryRunner.query(`
      ALTER TABLE student_observation_revisions
        ADD CONSTRAINT chk_student_observation_revisions_changed_by
        CHECK (
          num_nonnulls(
            changed_by_user_id,
            source_teacher_access_grant_id,
            changed_by_display_name
          ) >= 1
        ),
        ADD CONSTRAINT chk_student_observation_revisions_changed_by_display_name
        CHECK (
          changed_by_display_name IS NULL
          OR CHAR_LENGTH(BTRIM(changed_by_display_name)) BETWEEN 1 AND 200
        )
    `);

    // 3. The teacher imports keyed off a login username. Teachers are matched by
    //    citizen id now — the identity that is actually unique and that AraID
    //    verification already uses — so the reasons they can be rejected for
    //    change with them. The retired codes stay as reference rows because
    //    quarantined batches still name them.
    await queryRunner.query(`
      INSERT INTO student_import_quarantine_reason_codes (code, label_th, sort_order)
      VALUES
        ('BLANK_TEACHER_CITIZEN_ID', 'ไม่มีเลขประจำตัวประชาชนครู', 131),
        ('TEACHER_NOT_FOUND', 'ไม่พบครูในระบบ', 151),
        ('INACTIVE_TEACHER', 'ครูคนนี้ไม่ได้เปิดใช้งาน', 161)
      ON CONFLICT (code) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE student_import_quarantine_reason_codes
      SET label_th = 'ครูซ้ำในไฟล์'
      WHERE code = 'DUPLICATE_TEACHER_ROW'
    `);

    // 4. The legacy user pointers come out.
    await queryRunner.query(`DROP INDEX IF EXISTS idx_timetable_slots_teacher`);
    await queryRunner.query(`
      ALTER TABLE timetable_slots DROP COLUMN IF EXISTS teacher_user_id
    `);

    // The membership trigger existed to invent a teacher row from a login
    // account when only `teacher_user_id` was supplied. Every caller supplies
    // `teacher_id` now and there is no account left to read, so it goes — and
    // `teacher_id` becomes the requirement it was already standing in for.
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_school_teacher_memberships_resolve_identity
        ON school_teacher_memberships
    `);
    await queryRunner.query(`
      DROP FUNCTION IF EXISTS resolve_school_teacher_membership_identity()
    `);
    const membershipsWithoutTeacher = (await queryRunner.query(`
      SELECT COUNT(*)::text AS count FROM school_teacher_memberships WHERE teacher_id IS NULL
    `)) as Array<{ count: string }>;
    if (Number(membershipsWithoutTeacher[0]?.count ?? 0) > 0) {
      throw new Error(
        `RemoveTeacherUserAccounts: ${membershipsWithoutTeacher[0].count} school_teacher_memberships ` +
          'rows have no teacher_id. Resolve them before running this migration.',
      );
    }
    await queryRunner.query(`
      ALTER TABLE school_teacher_memberships ALTER COLUMN teacher_id SET NOT NULL
    `);

    // The uniqueness rule — one active membership per teacher per school — was
    // written against the account. Recreate it against the teacher before the
    // column that carries it disappears.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_school_teacher_memberships_active_teacher
        ON school_teacher_memberships (school_id, teacher_id)
        WHERE membership_status = 'ACTIVE' AND deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_school_teacher_memberships_scope_teacher
        ON school_teacher_memberships (school_id, membership_status, teacher_id)
        WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_school_teacher_memberships_active`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_school_teacher_memberships_scope`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_school_teacher_memberships_teacher`);
    await queryRunner.query(`
      ALTER TABLE school_teacher_memberships DROP COLUMN IF EXISTS teacher_user_id
    `);
    await queryRunner.query(`
      ALTER TABLE task_links DROP COLUMN IF EXISTS assigned_teacher_user_id
    `);
    await queryRunner.query(`
      ALTER TABLE teachers DROP COLUMN IF EXISTS linked_user_id
    `);

    // 5. The demo-provenance snapshots from 20260724 keep RESTRICT pointers at
    //    whoever the actor used to be. They describe accounts, not students, so
    //    a row naming a retired teacher account has nothing left to describe.
    for (const table of [
      'demo_provenance_case_review_backup_20260724',
      'demo_provenance_task_actor_backup_20260724',
      'demo_provenance_submission_actor_backup_20260724',
      'demo_provenance_attendance_session_backup_20260724',
      'demo_provenance_attendance_backup_20260724',
    ]) {
      const columns = (await queryRunner.query(
        `
          SELECT a.attname AS column_name
          FROM pg_constraint c
          JOIN unnest(c.conkey) k(attnum) ON TRUE
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass
            AND c.conrelid = to_regclass($1)
        `,
        [table],
      )) as Array<{ column_name: string }>;
      if (columns.length === 0) continue;
      const predicate = columns
        .map((column) => `"${column.column_name}" IN (SELECT id FROM users WHERE role = 'TEACHER')`)
        .join(' OR ');
      await queryRunner.query(`DELETE FROM ${table} WHERE ${predicate}`);
    }

    // Index only large child tables that actually reference a teacher account.
    // Indexing every users FK consumed the remaining production disk even when
    // most columns contained no teacher ids.
    const unindexedForeignKeys = (await queryRunner.query(`
      SELECT DISTINCT c.conrelid::regclass::text AS table_name, a.attname AS column_name
      FROM pg_constraint c
      JOIN unnest(c.conkey) k(attnum) ON TRUE
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f'
        AND c.confrelid = 'users'::regclass
        AND pg_relation_size(c.conrelid) >= 8388608
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
          JOIN pg_attribute ia ON ia.attrelid = i.indrelid AND ia.attnum = i.indkey[0]
          WHERE i.indrelid = c.conrelid AND ia.attname = a.attname
        )
      ORDER BY 1, 2
    `)) as Array<{ table_name: string; column_name: string }>;
    const createdIndexes: Array<{ name: string; table: string; column: string }> = [];
    for (const foreignKey of unindexedForeignKeys) {
      const referenced = (await queryRunner.query(`
        SELECT EXISTS (
          SELECT 1
          FROM ${foreignKey.table_name} child
          JOIN users account ON account.id = child."${foreignKey.column_name}"
          WHERE account.role = 'TEACHER'
        ) AS needed
      `)) as Array<{ needed: boolean }>;
      if (!referenced[0]?.needed) continue;
      const index = {
        name: `tmp_teacher_account_drop_${createdIndexes.length}`,
        table: foreignKey.table_name,
        column: foreignKey.column_name,
      };
      await queryRunner.query(`CREATE INDEX "${index.name}" ON ${index.table} ("${index.column}")`);
      createdIndexes.push(index);
    }

    try {
      // Anything still pointing at a teacher account with a blocking rule would
      // fail below as a bare foreign-key error naming a constraint. Name it here
      // instead, with the table, column and row count.
      const blockingForeignKeys = (await queryRunner.query(`
        SELECT DISTINCT c.conrelid::regclass::text AS table_name, a.attname AS column_name
        FROM pg_constraint c
        JOIN unnest(c.conkey) k(attnum) ON TRUE
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.contype = 'f'
          AND c.confrelid = 'users'::regclass
          AND c.confdeltype IN ('r', 'a')
        ORDER BY 1, 2
      `)) as Array<{ table_name: string; column_name: string }>;
      const blockers: string[] = [];
      for (const foreignKey of blockingForeignKeys) {
        const counted = (await queryRunner.query(`
          SELECT COUNT(*)::text AS count
          FROM ${foreignKey.table_name} blocked
          JOIN users account ON account.id = blocked."${foreignKey.column_name}"
          WHERE account.role = 'TEACHER'
        `)) as Array<{ count: string }>;
        const rows = Number(counted[0]?.count ?? 0);
        if (rows > 0) {
          blockers.push(`${foreignKey.table_name}.${foreignKey.column_name} (${rows} rows)`);
        }
      }
      if (blockers.length > 0) {
        throw new Error(
          'RemoveTeacherUserAccounts: these columns still point at a teacher account ' +
            `with a blocking delete rule: ${blockers.join(', ')}. ` +
            'Repoint or clear them before running this migration.',
        );
      }

      // 6. The accounts themselves.
      // Let the actor FKs null their references while retaining immutable rows.
      const immutableHistoryTriggers = [
        ['audit_log', 'trg_audit_log_immutable'],
        ['pii_access_events', 'trg_pii_access_events_immutable'],
        ['pii_export_events', 'trg_pii_export_events_immutable'],
      ] as const;
      for (const [table, trigger] of immutableHistoryTriggers) {
        await queryRunner.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
      }
      try {
        let deletedRows: number;
        do {
          const result = (await queryRunner.query(`
            WITH candidates AS (
              SELECT id
              FROM users
              WHERE role = 'TEACHER'
              ORDER BY id
              LIMIT 10
            ), deleted AS (
              DELETE FROM users account
              USING candidates
              WHERE account.id = candidates.id
              RETURNING 1
            )
            SELECT COUNT(*)::int AS deleted_rows FROM deleted
          `)) as Array<{ deleted_rows: number }>;
          deletedRows = Number(result[0]?.deleted_rows ?? 0);
        } while (deletedRows > 0);
      } finally {
        for (const [table, trigger] of [...immutableHistoryTriggers].reverse()) {
          await queryRunner.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
        }
      }
    } finally {
      for (const index of createdIndexes) {
        await queryRunner.query(`DROP INDEX IF EXISTS "${index.name}"`);
      }
    }

    await queryRunner.query(`DELETE FROM roles WHERE name = 'TEACHER'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE student_import_quarantine_reason_codes
      SET label_th = 'บัญชีครูซ้ำในไฟล์'
      WHERE code = 'DUPLICATE_TEACHER_ROW'
    `);
    await queryRunner.query(`
      DELETE FROM student_import_quarantine_reason_codes
      WHERE code IN ('BLANK_TEACHER_CITIZEN_ID', 'TEACHER_NOT_FOUND', 'INACTIVE_TEACHER')
        AND NOT EXISTS (
          SELECT 1 FROM student_import_quarantine_rows quarantined
          WHERE quarantined.reason_code = student_import_quarantine_reason_codes.code
        )
    `);
    await queryRunner.query(`
      INSERT INTO roles (name, label, default_permissions, scope_mode, scope_policy,
                         is_assignable, is_system)
      VALUES ('TEACHER', 'ครู', '[]'::jsonb, 'flexible', 'OWN_ONLY', FALSE, TRUE)
      ON CONFLICT (name) DO NOTHING
    `);

    await queryRunner.query(`
      ALTER TABLE teachers ADD COLUMN IF NOT EXISTS linked_user_id INTEGER
    `);
    await queryRunner.query(`
      ALTER TABLE teachers
        ADD CONSTRAINT fk_teachers_linked_user
        FOREIGN KEY (linked_user_id) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE task_links ADD COLUMN IF NOT EXISTS assigned_teacher_user_id INTEGER
    `);
    await queryRunner.query(`
      ALTER TABLE task_links
        ADD CONSTRAINT fk_task_links_assigned_teacher
        FOREIGN KEY (assigned_teacher_user_id) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE school_teacher_memberships ADD COLUMN IF NOT EXISTS teacher_user_id INTEGER
    `);
    await queryRunner.query(`
      ALTER TABLE school_teacher_memberships
        ADD CONSTRAINT fk_school_teacher_memberships_user
        FOREIGN KEY (teacher_user_id) REFERENCES users(id)
        ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_school_teacher_memberships_active
        ON school_teacher_memberships (school_id, teacher_user_id)
        WHERE membership_status = 'ACTIVE' AND deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_school_teacher_memberships_scope
        ON school_teacher_memberships (school_id, membership_status, teacher_user_id)
        WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_school_teacher_memberships_teacher
        ON school_teacher_memberships (teacher_user_id, membership_status)
        WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_school_teacher_memberships_active_teacher`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_school_teacher_memberships_scope_teacher`);
    await queryRunner.query(`
      ALTER TABLE school_teacher_memberships ALTER COLUMN teacher_id DROP NOT NULL
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION resolve_school_teacher_membership_identity()
      RETURNS TRIGGER AS $$
      DECLARE
        source_user users%ROWTYPE;
      BEGIN
        IF NEW.teacher_id IS NOT NULL THEN
          RETURN NEW;
        END IF;

        IF NEW.teacher_user_id IS NULL THEN
          RAISE EXCEPTION 'teacher membership needs either teacher_id or teacher_user_id'
            USING ERRCODE = '23502';
        END IF;

        SELECT teacher.id
        INTO NEW.teacher_id
        FROM teachers teacher
        WHERE teacher.linked_user_id = NEW.teacher_user_id
          AND teacher.deleted_at IS NULL
        LIMIT 1;

        IF NEW.teacher_id IS NOT NULL THEN
          RETURN NEW;
        END IF;

        SELECT * INTO source_user FROM users WHERE id = NEW.teacher_user_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'teacher account % does not exist', NEW.teacher_user_id
            USING ERRCODE = '23503';
        END IF;

        INSERT INTO teachers (
          first_name, last_name, citizen_id, phone, email, line_id,
          teacher_status, linked_user_id
        )
        VALUES (
          COALESCE(NULLIF(btrim(source_user."FirstName"), ''), source_user.username),
          COALESCE(NULLIF(btrim(source_user."LastName"), ''), '-'),
          CASE
            WHEN btrim(COALESCE(source_user."PersonID_Onec", '')) ~ '^[0-9]{13}$'
              AND NOT EXISTS (
                SELECT 1 FROM teachers existing
                WHERE existing.citizen_id = btrim(source_user."PersonID_Onec")
                  AND existing.deleted_at IS NULL
              )
            THEN btrim(source_user."PersonID_Onec")
          END,
          CASE
            WHEN btrim(COALESCE(source_user.phone, '')) ~ '^[0-9]{9,10}$'
            THEN btrim(source_user.phone)
          END,
          CASE
            WHEN position('@' IN btrim(COALESCE(source_user.email, ''))) > 1
              AND NOT EXISTS (
                SELECT 1 FROM teachers existing
                WHERE lower(btrim(existing.email)) = lower(btrim(source_user.email))
                  AND existing.deleted_at IS NULL
              )
            THEN btrim(source_user.email)
          END,
          NULLIF(btrim(COALESCE(source_user.line_id, '')), ''),
          CASE WHEN source_user.status = 'ACTIVE' THEN 'ACTIVE' ELSE 'INACTIVE' END,
          source_user.id
        )
        RETURNING id INTO NEW.teacher_id;

        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER trg_school_teacher_memberships_resolve_identity
        BEFORE INSERT OR UPDATE OF teacher_user_id, teacher_id
        ON school_teacher_memberships
        FOR EACH ROW EXECUTE FUNCTION resolve_school_teacher_membership_identity()
    `);

    await queryRunner.query(`
      ALTER TABLE timetable_slots ADD COLUMN IF NOT EXISTS teacher_user_id INTEGER
    `);
    await queryRunner.query(`
      ALTER TABLE timetable_slots
        ADD CONSTRAINT fk_timetable_slots_teacher
        FOREIGN KEY (teacher_user_id) REFERENCES users(id)
        ON DELETE SET NULL ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_timetable_slots_teacher
        ON timetable_slots(teacher_user_id)
        WHERE deleted_at IS NULL AND teacher_user_id IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE student_observation_revisions
        DROP CONSTRAINT IF EXISTS chk_student_observation_revisions_changed_by,
        DROP CONSTRAINT IF EXISTS chk_student_observation_revisions_changed_by_display_name
    `);
    await queryRunner.query(`
      DELETE FROM student_observation_revisions WHERE changed_by_user_id IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE student_observation_revisions ALTER COLUMN changed_by_user_id SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE student_observation_revisions
        DROP COLUMN IF EXISTS changed_by_display_name
    `);
    await queryRunner.query(`
      ALTER TABLE student_observations
        DROP CONSTRAINT IF EXISTS chk_student_observations_author_user,
        DROP CONSTRAINT IF EXISTS chk_student_observations_task_link_context
    `);
    await queryRunner.query(`
      DELETE FROM student_observations WHERE author_user_id IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE student_observations ALTER COLUMN author_user_id SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE student_observations
        ADD CONSTRAINT chk_student_observations_task_link_context
        CHECK (
          (
            source_task_link_id IS NULL
            AND source_timetable_slot_id IS NULL
            AND observer_display_name IS NULL
          )
          OR (
            author_kind = 'USER'
            AND source_task_link_id IS NOT NULL
            AND source_teacher_access_grant_id IS NULL
            AND author_teacher_membership_id IS NULL
            AND source_assignment_id IS NULL
            AND observer_display_name IS NOT NULL
          )
        )
    `);

    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        DROP CONSTRAINT IF EXISTS chk_classroom_student_comments_author
    `);
    await queryRunner.query(`
      DELETE FROM classroom_student_comments WHERE authored_by_user_id IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        ALTER COLUMN authored_by_user_id SET NOT NULL
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_classroom_student_comments_teacher`);
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        DROP CONSTRAINT IF EXISTS fk_classroom_student_comments_teacher
    `);
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments DROP COLUMN IF EXISTS authored_by_teacher_id
    `);
  }
}
