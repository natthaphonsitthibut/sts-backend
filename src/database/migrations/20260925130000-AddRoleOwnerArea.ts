import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Council menu groups belong to a จ./อ./ต., the way a school's groups belong to
 * the school (owner with BA, 2026-09-25). A group names its area by master-data
 * code, with the same composite keys `schools` uses, so a district can never
 * sit outside its province; all three NULL is a national group.
 *
 * Every council account whose scope is an area (not national, no school) then
 * moves from the national `ADMIN`/`EXECUTIVE` group to its own area's copy
 * (`A<code>_BASE_<key>`), created here for the areas already in use. The area's
 * ผู้ดูแลระบบ holds every page but the national ones. Moved accounts and their
 * previous group/pages are kept in `role_owner_area_backup_20260925`; `down()`
 * puts them back and drops the area groups.
 */
const GLOBAL_ONLY_PAGES = ['settings', 'master-data', 'manage-schools'];
const EXECUTIVE_PAGES = ['home', 'dashboard', 'export-data', 'nl_query:use'];
const BACKUP_TABLE = 'role_owner_area_backup_20260925';

export class AddRoleOwnerArea20260925130000 implements MigrationInterface {
  name = 'AddRoleOwnerArea20260925130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE roles
        ADD COLUMN IF NOT EXISTS owner_province_code VARCHAR(2) NULL,
        ADD COLUMN IF NOT EXISTS owner_district_code VARCHAR(4) NULL,
        ADD COLUMN IF NOT EXISTS owner_sub_district_code VARCHAR(6) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE roles
        DROP CONSTRAINT IF EXISTS chk_roles_owner_area_hierarchy,
        ADD CONSTRAINT chk_roles_owner_area_hierarchy CHECK (
          (owner_district_code IS NULL OR owner_province_code IS NOT NULL)
          AND (owner_sub_district_code IS NULL OR owner_district_code IS NOT NULL)
        ),
        DROP CONSTRAINT IF EXISTS chk_roles_owner_school_or_area,
        ADD CONSTRAINT chk_roles_owner_school_or_area CHECK (
          school_id IS NULL OR owner_province_code IS NULL
        ),
        DROP CONSTRAINT IF EXISTS chk_roles_area_group_not_system,
        ADD CONSTRAINT chk_roles_area_group_not_system CHECK (
          owner_province_code IS NULL OR is_system = FALSE
        ),
        DROP CONSTRAINT IF EXISTS fk_roles_owner_province,
        ADD CONSTRAINT fk_roles_owner_province
          FOREIGN KEY (owner_province_code)
          REFERENCES administrative_provinces (code)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        DROP CONSTRAINT IF EXISTS fk_roles_owner_district,
        ADD CONSTRAINT fk_roles_owner_district
          FOREIGN KEY (owner_district_code, owner_province_code)
          REFERENCES administrative_districts (code, province_code)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        DROP CONSTRAINT IF EXISTS fk_roles_owner_sub_district,
        ADD CONSTRAINT fk_roles_owner_sub_district
          FOREIGN KEY (owner_sub_district_code, owner_district_code, owner_province_code)
          REFERENCES administrative_sub_districts (code, district_code, province_code)
          ON UPDATE CASCADE ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_roles_owner_area
        ON roles (owner_province_code, owner_district_code, owner_sub_district_code)
        WHERE owner_province_code IS NOT NULL
    `);
    // One label per owning area, the rule school groups have per school.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_area_label_ci
        ON roles (
          owner_province_code,
          COALESCE(owner_district_code, ''),
          COALESCE(owner_sub_district_code, ''),
          LOWER(BTRIM(label))
        )
        WHERE owner_province_code IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
        user_id INTEGER PRIMARY KEY,
        role TEXT NOT NULL,
        permissions JSONB,
        area_role TEXT NOT NULL
      )
    `);

    // Each area council account's own area, resolved from its scope names to
    // codes: its deepest level, and the national group it copies.
    await queryRunner.query(`
      CREATE TEMP TABLE area_accounts ON COMMIT DROP AS
      SELECT
        account.id AS user_id,
        account.role,
        account.permissions,
        province.code AS province_code,
        district.code AS district_code,
        sub_district.code AS sub_district_code,
        'A' || COALESCE(sub_district.code, district.code, province.code)
          || '_BASE_' || account.role AS area_role
      FROM users account
      JOIN administrative_provinces province
        ON province.name_th = account.data_scope->'provinces'->>0
      LEFT JOIN administrative_districts district
        ON district.province_code = province.code
       AND district.name_th = account.data_scope->'districts'->>0
      LEFT JOIN administrative_sub_districts sub_district
        ON sub_district.district_code = district.code
       AND sub_district.name_th = account.data_scope->'sub_districts'->>0
      WHERE account.role IN ('ADMIN', 'EXECUTIVE')
        AND COALESCE((account.data_scope->>'global')::boolean, FALSE) = FALSE
        AND jsonb_array_length(COALESCE(account.data_scope->'school_ids', '[]'::jsonb)) = 0
        AND jsonb_array_length(COALESCE(account.data_scope->'provinces', '[]'::jsonb)) = 1
        AND jsonb_array_length(COALESCE(account.data_scope->'districts', '[]'::jsonb)) <= 1
        AND jsonb_array_length(COALESCE(account.data_scope->'sub_districts', '[]'::jsonb)) <= 1
        -- A named level that does not resolve is left alone, never guessed.
        AND (account.data_scope->'districts'->>0 IS NULL OR district.code IS NOT NULL)
        AND (account.data_scope->'sub_districts'->>0 IS NULL OR sub_district.code IS NOT NULL)
    `);

    await queryRunner.query(
      `
      INSERT INTO roles (
        name, label, default_permissions, scope_mode, scope_policy,
        is_assignable, is_system, school_id,
        owner_province_code, owner_district_code, owner_sub_district_code
      )
      SELECT DISTINCT
        area.area_role,
        CASE WHEN area.role = 'ADMIN' THEN 'ผู้ดูแลระบบ' ELSE 'ผู้บริหาร' END,
        CASE WHEN area.role = 'ADMIN'
          THEN (
            SELECT COALESCE(jsonb_agg(page), '[]'::jsonb)
            FROM jsonb_array_elements_text(national.default_permissions) page
            WHERE page <> ALL ($1::text[])
          )
          ELSE $2::jsonb
        END,
        'flexible', 'ASSIGNABLE', TRUE, FALSE, NULL::integer,
        area.province_code, area.district_code, area.sub_district_code
      FROM area_accounts area
      JOIN roles national ON national.name = area.role
      ON CONFLICT (name) DO NOTHING
    `,
      [GLOBAL_ONLY_PAGES, JSON.stringify(EXECUTIVE_PAGES)],
    );

    await queryRunner.query(`
      INSERT INTO ${BACKUP_TABLE} (user_id, role, permissions, area_role)
      SELECT user_id, role, permissions, area_role FROM area_accounts
      ON CONFLICT (user_id) DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE users account
      SET role = area.area_role,
          permissions = area_group.default_permissions
      FROM area_accounts area
      JOIN roles area_group ON area_group.name = area.area_role
      WHERE account.id = area.user_id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users account
      SET role = backup.role, permissions = backup.permissions
      FROM ${BACKUP_TABLE} backup
      WHERE account.id = backup.user_id
    `);
    const [inUse] = (await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM users account
      JOIN roles r ON r.name = account.role
      WHERE r.owner_province_code IS NOT NULL
    `)) as Array<{ count: number }>;
    if ((inUse?.count ?? 0) > 0) {
      // Accounts put on an area group after this migration have no older
      // group to return to; dropping the columns would make it national.
      throw new Error(
        'Accounts still use area menu groups created after AddRoleOwnerArea; move them first',
      );
    }
    await queryRunner.query(`DELETE FROM roles WHERE owner_province_code IS NOT NULL`);
    await queryRunner.query(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_roles_area_label_ci`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_roles_owner_area`);
    await queryRunner.query(`
      ALTER TABLE roles
        DROP CONSTRAINT IF EXISTS fk_roles_owner_sub_district,
        DROP CONSTRAINT IF EXISTS fk_roles_owner_district,
        DROP CONSTRAINT IF EXISTS fk_roles_owner_province,
        DROP CONSTRAINT IF EXISTS chk_roles_area_group_not_system,
        DROP CONSTRAINT IF EXISTS chk_roles_owner_school_or_area,
        DROP CONSTRAINT IF EXISTS chk_roles_owner_area_hierarchy,
        DROP COLUMN IF EXISTS owner_sub_district_code,
        DROP COLUMN IF EXISTS owner_district_code,
        DROP COLUMN IF EXISTS owner_province_code
    `);
  }
}
