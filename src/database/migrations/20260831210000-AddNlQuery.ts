import type { MigrationInterface, QueryRunner } from 'typeorm';

const NL_QUERY_PERMISSION = 'nl_query:use';
const NL_QUERY_ROLES = ['ADMIN', 'EXECUTIVE'] as const;

export class AddNlQuery20260831210000 implements MigrationInterface {
  name = 'AddNlQuery20260831210000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS nl_query_log (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NULL,
        data_scope JSONB NULL,
        question TEXT NOT NULL,
        status VARCHAR(12) NOT NULL,
        request_id VARCHAR NULL,
        sql TEXT NULL,
        error_code VARCHAR(32) NULL,
        error_detail TEXT NULL,
        row_count INTEGER NULL,
        retry_count INTEGER NULL,
        elapsed_ms INTEGER NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ NULL,
        CONSTRAINT chk_nl_query_log_status
          CHECK (status IN ('pending', 'ok', 'error', 'failed')),
        CONSTRAINT fk_nl_query_log_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_nl_query_log_user_id ON nl_query_log (user_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_nl_query_log_request_id ON nl_query_log (request_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_nl_query_log_created_at ON nl_query_log (created_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_nl_query_log_status ON nl_query_log (status)
    `);

    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions || $1::jsonb
        WHERE name = ANY($2::text[])
          AND NOT (COALESCE(default_permissions, '[]'::jsonb) ? $3)
      `,
      [JSON.stringify([NL_QUERY_PERMISSION]), NL_QUERY_ROLES, NL_QUERY_PERMISSION],
    );
    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions || $1::jsonb
        WHERE role = ANY($2::text[])
          AND jsonb_typeof(permissions) = 'array'
          AND NOT (permissions ? $3)
      `,
      [JSON.stringify([NL_QUERY_PERMISSION]), NL_QUERY_ROLES, NL_QUERY_PERMISSION],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE users
        SET permissions = permissions - $1
        WHERE role = ANY($2::text[])
          AND jsonb_typeof(permissions) = 'array'
      `,
      [NL_QUERY_PERMISSION, NL_QUERY_ROLES],
    );
    await queryRunner.query(
      `
        UPDATE roles
        SET default_permissions = default_permissions - $1
        WHERE name = ANY($2::text[])
      `,
      [NL_QUERY_PERMISSION, NL_QUERY_ROLES],
    );

    await queryRunner.query(`DROP INDEX IF EXISTS idx_nl_query_log_status`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_nl_query_log_created_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_nl_query_log_request_id`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_nl_query_log_user_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS nl_query_log`);
  }
}
