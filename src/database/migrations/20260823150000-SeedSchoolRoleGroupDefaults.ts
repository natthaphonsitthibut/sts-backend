import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Restores the editable starter menu groups for every school.
 *
 * The page-permission collapse removed the unused generated rows while the
 * menu-group screen still deliberately lists only school-owned groups.  Copy
 * the three approved global templates so each school starts from the same page set,
 * without altering any operator-created group.
 */
export class SeedSchoolRoleGroupDefaults20260823150000 implements MigrationInterface {
  name = 'SeedSchoolRoleGroupDefaults20260823150000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH templates(template_key, label, source_name, fallback_source_name) AS (
        VALUES
          ('ADMIN', 'ผู้ดูแลระบบ', 'ADMIN', NULL::TEXT),
          ('EXECUTIVE', 'ผู้บริหาร', 'EXECUTIVE', NULL::TEXT),
          ('DIRECTOR', 'ผู้อำนวยการ', 'DIRECTOR', NULL::TEXT)
      ),
      template_roles AS (
        SELECT
          template.template_key,
          template.label,
          source_role.default_permissions
        FROM templates template
        JOIN LATERAL (
          SELECT role_record.default_permissions
          FROM roles role_record
          WHERE role_record.school_id IS NULL
            AND role_record.is_assignable = TRUE
            AND role_record.name IN (
              template.source_name,
              COALESCE(template.fallback_source_name, template.source_name)
            )
          ORDER BY CASE WHEN role_record.name = template.source_name THEN 0 ELSE 1 END
          LIMIT 1
        ) source_role ON TRUE
      )
      INSERT INTO roles (
        name, label, default_permissions, scope_mode, scope_policy,
        is_assignable, is_system, school_id
      )
      SELECT
        'S' || school.id || '_BASE_' || template.template_key,
        template.label,
        template.default_permissions,
        'school',
        'ASSIGNABLE',
        TRUE,
        FALSE,
        school.id
      FROM schools school
      CROSS JOIN template_roles template
      WHERE NOT EXISTS (
        SELECT 1
        FROM roles existing_role
        WHERE existing_role.school_id = school.id
          AND LOWER(BTRIM(existing_role.label)) = LOWER(BTRIM(template.label))
      )
      ON CONFLICT (name) DO UPDATE
      SET label = EXCLUDED.label,
          default_permissions = EXCLUDED.default_permissions,
          scope_mode = EXCLUDED.scope_mode,
          scope_policy = EXCLUDED.scope_policy,
          is_assignable = TRUE,
          is_system = FALSE,
          school_id = EXCLUDED.school_id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // An account assigned to one of these groups would make the delete fail on
    // the users→roles foreign key with nothing but a constraint name to explain
    // it. Say which groups are still in use instead.
    const attached = (await queryRunner.query(`
      SELECT role_group.name, COUNT(account.id)::text AS accounts
      FROM roles role_group
      JOIN users account ON account.role = role_group.name
      WHERE role_group.school_id IS NOT NULL
        AND role_group.name ~ '^S[0-9]+_BASE_(ADMIN|EXECUTIVE|DIRECTOR)$'
      GROUP BY role_group.name
      ORDER BY role_group.name
    `)) as Array<{ name: string; accounts: string }>;
    if (attached.length > 0) {
      const detail = attached.map((row) => `${row.name} (${row.accounts})`).join(', ');
      throw new Error(
        `SeedSchoolRoleGroupDefaults: accounts are still assigned to these starter groups: ` +
          `${detail}. Move them to another menu group before reverting.`,
      );
    }

    await queryRunner.query(`
      DELETE FROM roles
      WHERE school_id IS NOT NULL
        AND name ~ '^S[0-9]+_BASE_(ADMIN|EXECUTIVE|DIRECTOR)$'
    `);
  }
}
