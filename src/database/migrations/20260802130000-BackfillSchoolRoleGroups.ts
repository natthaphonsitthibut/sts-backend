import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives every existing school the same editable starter groups. Permission
 * bundles are copied from the matching global roles at migration time so the
 * backfill preserves the deployment's current role baseline.
 */
export class BackfillSchoolRoleGroups20260802130000 implements MigrationInterface {
  name = 'BackfillSchoolRoleGroups20260802130000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      WITH templates(template_key, label, source_name, fallback_source_name) AS (
        VALUES
          ('ADMIN', 'ผู้ดูแลระบบ', 'ADMIN', NULL::TEXT),
          ('EXECUTIVE', 'ผู้บริหาร', 'EXECUTIVE', NULL::TEXT),
          ('ADMIN_SCHOOL', 'ผู้ดูแลระบบประจำโรงเรียน', 'ADMIN_SCHOOL', 'ADMIN'),
          ('DIRECTOR', 'ผู้อำนวยการ', 'DIRECTOR', NULL::TEXT)
      ),
      template_roles AS (
        SELECT
          template.template_key,
          template.label,
          source_role.rank,
          source_role.default_permissions
        FROM templates template
        JOIN LATERAL (
          SELECT role_record.rank, role_record.default_permissions
          FROM roles role_record
          WHERE role_record.school_id IS NULL
            AND role_record.name IN (
              template.source_name,
              COALESCE(template.fallback_source_name, template.source_name)
            )
          ORDER BY CASE WHEN role_record.name = template.source_name THEN 0 ELSE 1 END
          LIMIT 1
        ) source_role ON TRUE
      )
      INSERT INTO roles (
        name,
        label,
        rank,
        default_permissions,
        scope_mode,
        scope_policy,
        is_assignable,
        is_system,
        school_id
      )
      SELECT
        'S' || school.id || '_BASE_' || template.template_key,
        template.label,
        template.rank,
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
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM roles
      WHERE school_id IS NOT NULL
        AND name ~ '^S[0-9]+_BASE_(ADMIN|EXECUTIVE|ADMIN_SCHOOL|DIRECTOR)$'
    `);
  }
}
