import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `case:assign` and `case:review` fold into one `case:manage` (owner,
 * 2026-10-15): reading cases stays `dashboard`, and acting on them is a single
 * level rather than one permission per button. Who holds it does not change:
 * by default ผอ. acts, ผู้ดูแลระบบ and ผู้บริหาร read.
 *
 * Every group or account that held either old id holds `case:manage` instead,
 * so nobody loses an action. `case_review_actions` buttons ask for
 * `case:manage`.
 *
 * Data only: no table or column changes. `down()` turns every `case:manage`
 * back into both old ids.
 */
const OLD_IDS = ['case:assign', 'case:review'];
const NEW_ID = 'case:manage';

const appendMissing = (column: string) => `
  ${column} || COALESCE((
    SELECT jsonb_agg(permission)
    FROM jsonb_array_elements_text($1::jsonb) AS added(permission)
    WHERE NOT (${column} ? permission)
  ), '[]'::jsonb)`;

export class MergeCaseActionPermissions20261015100000 implements MigrationInterface {
  name = 'MergeCaseActionPermissions20261015100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const added = JSON.stringify([NEW_ID]);

    await queryRunner.query(
      `
      UPDATE roles
      SET default_permissions = (${appendMissing('default_permissions')}) - $2::text[]
      WHERE default_permissions ?| $2::text[]
    `,
      [added, OLD_IDS],
    );
    await queryRunner.query(
      `
      UPDATE users
      SET permissions = (${appendMissing('permissions')}) - $2::text[]
      WHERE permissions ?| $2::text[]
    `,
      [added, OLD_IDS],
    );
    await queryRunner.query(
      `
      UPDATE case_review_actions
      SET required_permission_code = $1
      WHERE required_permission_code = ANY($2::text[])
    `,
      [NEW_ID, OLD_IDS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const restored = JSON.stringify(OLD_IDS);

    await queryRunner.query(
      `
      UPDATE case_review_actions
      SET required_permission_code = 'case:review'
      WHERE required_permission_code = $1
    `,
      [NEW_ID],
    );
    await queryRunner.query(
      `
      UPDATE roles
      SET default_permissions = (${appendMissing('default_permissions')}) - $2::text
      WHERE default_permissions ? $2::text
    `,
      [restored, NEW_ID],
    );
    await queryRunner.query(
      `
      UPDATE users
      SET permissions = (${appendMissing('permissions')}) - $2::text
      WHERE permissions ? $2::text
    `,
      [restored, NEW_ID],
    );
  }
}
