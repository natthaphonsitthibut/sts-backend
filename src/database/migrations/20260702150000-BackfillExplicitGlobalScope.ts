import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Scoped reads now fail closed on a semantically-empty data scope (no area
 * values, no explicit `global:true` / `own_only:true`). Accounts and LOGIN
 * links whose "nationwide" intent was stored as an empty object (rows written
 * after the 20260629160000 backfill — the UI sends {} for confirmed-nationwide)
 * must therefore be marked explicitly, or they would read 0 rows after deploy.
 *
 * Rules (mirrors 20260629160000, generalized to custom roles):
 * - role scope_policy = 'OWN_ONLY'  -> data scope becomes {"own_only":true}
 * - any other known role            -> data scope gets  {"global":true}
 * - non-object / unknown-role rows are left untouched (fail closed by design)
 */

// A stored scope that grants nothing explicitly: an object with no true
// global/own_only flag and no non-empty area array. jsonb_typeof guards keep
// corrupt shapes (non-object scope, non-array area keys) out of the backfill.
function semanticallyEmptyScopeSql(column: string): string {
  const noArea = (key: string): string =>
    `(jsonb_typeof(${column} -> '${key}') IS DISTINCT FROM 'array'
      OR jsonb_array_length(${column} -> '${key}') = 0)`;

  return `
    jsonb_typeof(${column}) = 'object'
    AND (${column} -> 'global') IS DISTINCT FROM 'true'::jsonb
    AND (${column} -> 'own_only') IS DISTINCT FROM 'true'::jsonb
    AND ${noArea('provinces')}
    AND ${noArea('districts')}
    AND ${noArea('sub_districts')}
    AND ${noArea('school_ids')}
    AND ${noArea('grade_levels')}
    AND ${noArea('room_ids')}
  `;
}

export class BackfillExplicitGlobalScope20260702150000 implements MigrationInterface {
  name = 'BackfillExplicitGlobalScope20260702150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const emptyUserScope = semanticallyEmptyScopeSql(`COALESCE(u.data_scope, '{}'::jsonb)`);
    const emptyLinkScope = semanticallyEmptyScopeSql(`COALESCE(tl.login_data_scope, '{}'::jsonb)`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS user_scope_backfill_20260702_backup (
        user_id INTEGER PRIMARY KEY,
        old_data_scope JSONB
      )
    `);
    await queryRunner.query(`
      INSERT INTO user_scope_backfill_20260702_backup (user_id, old_data_scope)
      SELECT u.id, u.data_scope
      FROM users u
      JOIN roles r ON r.name = u.role
      WHERE ${emptyUserScope}
      ON CONFLICT (user_id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE users u
      SET data_scope = CASE
        WHEN r.scope_policy = 'OWN_ONLY' THEN '{"own_only":true}'::jsonb
        ELSE COALESCE(u.data_scope, '{}'::jsonb) || '{"global":true}'::jsonb
      END
      FROM roles r
      WHERE r.name = u.role
        AND u.id IN (SELECT user_id FROM user_scope_backfill_20260702_backup)
        AND ${emptyUserScope}
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS task_link_scope_backfill_20260702_backup (
        task_link_id TEXT PRIMARY KEY,
        old_login_data_scope JSONB
      )
    `);
    await queryRunner.query(`
      INSERT INTO task_link_scope_backfill_20260702_backup (task_link_id, old_login_data_scope)
      SELECT tl.id, tl.login_data_scope
      FROM task_links tl
      JOIN roles r ON r.name = tl.login_role
      WHERE tl.login_role IS NOT NULL
        AND ${emptyLinkScope}
      ON CONFLICT (task_link_id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE task_links tl
      SET login_data_scope = CASE
        WHEN r.scope_policy = 'OWN_ONLY' THEN '{"own_only":true}'::jsonb
        ELSE COALESCE(tl.login_data_scope, '{}'::jsonb) || '{"global":true}'::jsonb
      END
      FROM roles r
      WHERE r.name = tl.login_role
        AND tl.login_role IS NOT NULL
        AND tl.id IN (SELECT task_link_id FROM task_link_scope_backfill_20260702_backup)
        AND ${emptyLinkScope}
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users u
      SET data_scope = backup.old_data_scope
      FROM user_scope_backfill_20260702_backup backup
      WHERE u.id = backup.user_id
    `);
    await queryRunner.query(`
      UPDATE task_links tl
      SET login_data_scope = backup.old_login_data_scope
      FROM task_link_scope_backfill_20260702_backup backup
      WHERE tl.id = backup.task_link_id
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS task_link_scope_backfill_20260702_backup`);
    await queryRunner.query(`DROP TABLE IF EXISTS user_scope_backfill_20260702_backup`);
  }
}
