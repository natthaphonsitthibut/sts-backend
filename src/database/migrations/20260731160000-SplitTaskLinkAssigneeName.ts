import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SplitTaskLinkAssigneeName20260731160000 implements MigrationInterface {
  name = 'SplitTaskLinkAssigneeName20260731160000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links
        ADD COLUMN assigned_to_first_name VARCHAR(150),
        ADD COLUMN assigned_to_last_name VARCHAR(150),
        ADD CONSTRAINT task_links_assigned_to_first_name_not_blank_check
          CHECK (
            assigned_to_first_name IS NULL
            OR BTRIM(assigned_to_first_name) <> ''
          ),
        ADD CONSTRAINT task_links_assigned_to_last_name_not_blank_check
          CHECK (
            assigned_to_last_name IS NULL
            OR BTRIM(assigned_to_last_name) <> ''
          )
    `);

    await queryRunner.query(`
      WITH normalized_names AS (
        SELECT
          id,
          REGEXP_REPLACE(BTRIM(assigned_to_name), '[[:space:]]+', ' ', 'g') AS full_name
        FROM task_links
        WHERE assigned_to_name IS NOT NULL
          AND BTRIM(assigned_to_name) <> ''
      )
      UPDATE task_links AS link
      SET
        assigned_to_first_name = NULLIF(SPLIT_PART(normalized.full_name, ' ', 1), ''),
        assigned_to_last_name = NULLIF(
          REGEXP_REPLACE(normalized.full_name, '^[^ ]+[ ]*', ''),
          ''
        )
      FROM normalized_names AS normalized
      WHERE link.id = normalized.id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_links
        DROP CONSTRAINT IF EXISTS task_links_assigned_to_last_name_not_blank_check,
        DROP CONSTRAINT IF EXISTS task_links_assigned_to_first_name_not_blank_check,
        DROP COLUMN IF EXISTS assigned_to_last_name,
        DROP COLUMN IF EXISTS assigned_to_first_name
    `);
  }
}
