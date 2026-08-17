import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One permission per page (2026-08-17).
 *
 * The catalogue had grown two vocabularies for the same thing — permission ids
 * with their own labels, and page titles in the sidebar — and eight of seventeen
 * had drifted apart, so an operator ticking "ดูภาพรวมและความครบถ้วนการเช็กชื่อ"
 * had to know it meant the page called "ความครบถ้วน". Holding a page now means
 * doing everything on that page, and the permission is named after it.
 *
 * Stored values move with the code:
 *   - `users.permissions` and `roles.default_permissions`
 *   - `case_review_actions.required_permission_code`
 *   - `notification_types.required_permission`
 *   - `task_links.login_permissions` (retired LOGIN links, mapped for consistency)
 *
 * Two pages had no permission of their own and were reachable through another's,
 * so anyone who could see them keeps seeing them: `timetable` is granted wherever
 * `home` was, and `classrooms` wherever `manage-school-structure` was. Without
 * that both menus would vanish system-wide on deploy.
 *
 * `down()` restores every jsonb list verbatim from the backup table.
 */
export class CollapsePermissionsToPages20260821090000 implements MigrationInterface {
  name = 'CollapsePermissionsToPages20260821090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS permission_page_collapse_backup_20260821 (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        original JSONB NOT NULL,
        PRIMARY KEY (scope, key)
      )
    `);
    await queryRunner.query(`
      INSERT INTO permission_page_collapse_backup_20260821 (scope, key, original)
      SELECT 'user', id::text, COALESCE(permissions, '[]'::jsonb) FROM users
      ON CONFLICT (scope, key) DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO permission_page_collapse_backup_20260821 (scope, key, original)
      SELECT 'role', name, COALESCE(default_permissions, '[]'::jsonb) FROM roles
      ON CONFLICT (scope, key) DO NOTHING
    `);

    // The map, shared by every column below. NULL target = the id disappears
    // with nothing inheriting it.
    await queryRunner.query(`
      CREATE TEMP TABLE permission_page_map (old_id TEXT PRIMARY KEY, new_id TEXT) ON COMMIT DROP
    `);
    await queryRunner.query(`
      INSERT INTO permission_page_map (old_id, new_id) VALUES
        ('edit-students', 'students'),
        ('student-observations', 'students'),
        ('manage-student-observations', 'students'),
        ('review-cases', 'dashboard'),
        ('assign-follow-up-cases', 'dashboard'),
        ('close-case', 'dashboard'),
        ('create', 'dashboard'),
        ('import-school-roster', 'import-data'),
        ('manage-attendance-calendar', 'attendance-dashboard'),
        ('manage-timetable', 'timetable'),
        ('manage-users-hard-delete', 'manage-users-list'),
        ('manage-schools', 'settings'),
        -- Retired with the field-followers feature in 20260814120000 but still
        -- stored on the DIRECTOR row.
        ('field-monitor', NULL),
        ('manage-student-accounts', NULL),
        ('login-links', NULL)
    `);

    // Everything an actor may hold after the collapse.
    await queryRunner.query(`
      CREATE TEMP TABLE permission_page_catalog (id TEXT PRIMARY KEY) ON COMMIT DROP
    `);
    await queryRunner.query(`
      INSERT INTO permission_page_catalog (id) VALUES
        ('home'), ('dashboard'), ('students'), ('classrooms'), ('student-self'),
        ('manage-school-structure'), ('manage-curriculum'), ('import-data'),
        ('export-data'), ('attendance-dashboard'), ('attendance'),
        ('manage-teacher-access'), ('timetable'), ('manage-users-list'),
        ('manage-teachers'), ('manage-role-groups'), ('settings'), ('audit-log')
    `);

    const collapse = (source: string) => `
      (
        SELECT COALESCE(jsonb_agg(DISTINCT mapped ORDER BY mapped), '[]'::jsonb)
        FROM (
          SELECT COALESCE(map.new_id, raw.value) AS mapped
          FROM jsonb_array_elements_text(COALESCE(${source}, '[]'::jsonb)) raw(value)
          LEFT JOIN permission_page_map map ON map.old_id = raw.value
          WHERE COALESCE(map.new_id, raw.value) IS NOT NULL

          UNION

          -- ตารางสอน used to ride on หน้าหลัก, ห้องเรียนทั้งหมด on
          -- จัดการภาคเรียนและห้องเรียน. Grant them explicitly so no menu is lost.
          SELECT 'timetable'
          WHERE COALESCE(${source}, '[]'::jsonb) ? 'home'

          UNION

          SELECT 'classrooms'
          WHERE COALESCE(${source}, '[]'::jsonb) ? 'manage-school-structure'
        ) collapsed
        JOIN permission_page_catalog ON permission_page_catalog.id = collapsed.mapped
      )
    `;

    await queryRunner.query(`UPDATE users SET permissions = ${collapse('users.permissions')}`);
    await queryRunner.query(
      `UPDATE roles SET default_permissions = ${collapse('roles.default_permissions')}`,
    );
    await queryRunner.query(
      `UPDATE task_links SET login_permissions = ${collapse('task_links.login_permissions')}
       WHERE login_permissions IS NOT NULL`,
    );

    for (const [table, column] of [
      ['case_review_actions', 'required_permission_code'],
      ['notification_types', 'required_permission'],
    ]) {
      await queryRunner.query(`
        UPDATE ${table} target
        SET ${column} = map.new_id
        FROM permission_page_map map
        WHERE map.old_id = target.${column} AND map.new_id IS NOT NULL
      `);
    }

    // Per-school role groups: 44 rows generated in 20260802120000 that never had
    // an account. Fail loudly rather than orphan anyone if that changed.
    await queryRunner.query(`
      DO $$
      DECLARE attached INTEGER;
      BEGIN
        SELECT COUNT(*) INTO attached
        FROM users WHERE role IN (SELECT name FROM roles WHERE name LIKE 'S%\\_BASE\\_%');
        IF attached > 0 THEN
          RAISE EXCEPTION 'ยังมีบัญชี % รายการผูกกับกลุ่มเมนูรายโรงเรียน ลบไม่ได้', attached;
        END IF;
      END $$
    `);
    await queryRunner.query(`DELETE FROM roles WHERE name LIKE 'S%\\_BASE\\_%'`);

    // Teachers reach the system through their access link and students no longer
    // sign in at all — neither is a menu group any more, and neither keeps a
    // usable credential. The rows stay: 991k attendance records name them.
    await queryRunner.query(`
      UPDATE roles
      SET is_assignable = FALSE, default_permissions = '[]'::jsonb
      WHERE name IN ('TEACHER', 'STUDENT')
    `);
    await queryRunner.query(`
      UPDATE users
      SET password = 'NOT_A_LOGIN_CREDENTIAL', must_change_password = FALSE,
          temporary_password_issued_at = NULL, temporary_password_expires_at = NULL
      WHERE role IN ('TEACHER', 'STUDENT')
        AND username <> 'newnew'
    `);

    // The owner's own account stays in: it is the way back into the system if
    // anything here is wrong, so it keeps its credential, sits in a group that can
    // be assigned, and holds every page. Its data scope is left untouched — scope
    // answers "which rows", permissions answer "which pages".
    await queryRunner.query(`
      UPDATE users
      SET role = 'ADMIN',
          permissions = (SELECT jsonb_agg(id ORDER BY id) FROM permission_page_catalog)
      WHERE username = 'newnew'
    `);

    // Student accounts were retired in 20260802150000 and the rows left behind
    // are all disabled with no attendance history, so they can go — except the
    // ones that appear in `audit_log`. That table is append-only by trigger, so
    // the `ON DELETE SET NULL` the foreign key would perform is itself refused;
    // deleting those rows would mean rewriting history to erase an account.
    // They stay, credential-less and unassignable, and the log keeps naming who
    // did what.
    await queryRunner.query(`
      DELETE FROM users
      WHERE role = 'STUDENT'
        AND NOT EXISTS (SELECT 1 FROM audit_log WHERE audit_log.actor_user_id = users.id)
    `);

    // No assignable group may be empty: an operator picking it would grant
    // nothing at all.
    await queryRunner.query(`
      DO $$
      DECLARE empty_groups TEXT;
      BEGIN
        SELECT string_agg(name, ', ') INTO empty_groups
        FROM roles
        WHERE is_assignable
          AND jsonb_array_length(COALESCE(default_permissions, '[]'::jsonb)) = 0;
        IF empty_groups IS NOT NULL THEN
          RAISE EXCEPTION 'กลุ่มเมนูที่เลือกได้ต้องมีสิทธิ์อย่างน้อยหนึ่งหน้า: %', empty_groups;
        END IF;
      END $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users target
      SET permissions = backup.original
      FROM permission_page_collapse_backup_20260821 backup
      WHERE backup.scope = 'user' AND backup.key = target.id::text
    `);
    await queryRunner.query(`
      UPDATE roles target
      SET default_permissions = backup.original
      FROM permission_page_collapse_backup_20260821 backup
      WHERE backup.scope = 'role' AND backup.key = target.name
    `);
    await queryRunner.query(`
      UPDATE roles SET is_assignable = TRUE WHERE name = 'TEACHER'
    `);
    await queryRunner.query(`
      UPDATE case_review_actions SET required_permission_code = 'close-case' WHERE code = 'CLOSE'
    `);
    await queryRunner.query(`
      UPDATE case_review_actions SET required_permission_code = 'review-cases'
      WHERE code IN ('REFER_AGENCY', 'ASSIST')
    `);
    await queryRunner.query(`
      UPDATE notification_types SET required_permission = 'review-cases'
      WHERE code = 'CASE_STATUS_CHANGED'
    `);
    // The deleted per-school groups and student accounts are not recreated:
    // both were unused, and inventing rows on the way back would be worse than
    // leaving them gone. The backup table keeps what each one carried.
  }
}
