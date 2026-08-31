import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets the remaining append-only logs release a deleted actor.
 *
 * `audit_log`, `pii_export_events` and `data_export_job_event` all declare
 * `actor_user_id ... ON DELETE SET NULL`, and all three carry a guard that
 * raises on every UPDATE and DELETE. A referential action *is* an UPDATE, so
 * the guard refused it and deleting a user failed outright with
 * "audit_log is append-only; UPDATE is not allowed" — the declared behaviour
 * could never happen, and `listUserOperationalReferences` cannot warn about it
 * because these are not operational references, they are evidence.
 *
 * `AllowPiiAccessActorRelease20260828110000` already fixed `pii_access_events`
 * this way; this brings the other three in line. Each allows exactly one write
 * and nothing else: it must come from inside another trigger (a referential
 * action runs nested, an app statement runs at depth 1), every other column
 * must be byte-identical, and `actor_user_id` may only go from set to NULL —
 * never the other way, which would let someone pin a logged action on a
 * different person. DELETE stays blocked outright: the record that something
 * happened never goes away, only the pointer to a row that no longer exists.
 */
export class ReleaseAppendOnlyActorReferences20260831110000 implements MigrationInterface {
  name = 'ReleaseAppendOnlyActorReferences20260831110000';

  /** The one exception each guard makes, shared so the three cannot drift. */
  private static releaseClause(): string {
    return `
      IF TG_OP = 'UPDATE'
        AND pg_trigger_depth() > 1
        AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id')
        AND NEW.actor_user_id IS NULL
        AND OLD.actor_user_id IS NOT NULL
      THEN
        RETURN NEW;
      END IF;
    `;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const release = ReleaseAppendOnlyActorReferences20260831110000.releaseClause();
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_log_block_mutation()
        RETURNS trigger AS $audit_log_block_mutation$
        BEGIN
          ${release}
          RAISE EXCEPTION 'audit_log is append-only; % is not allowed', TG_OP;
        END;
        $audit_log_block_mutation$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION pii_export_events_block_mutation()
        RETURNS trigger AS $pii_export_events_block_mutation$
        BEGIN
          ${release}
          RAISE EXCEPTION 'pii_export_events is append-only; % is not allowed', TG_OP;
        END;
        $pii_export_events_block_mutation$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_data_export_job_event_mutation()
        RETURNS trigger AS $prevent_data_export_job_event_mutation$
        BEGIN
          ${release}
          RAISE EXCEPTION 'data_export_job_event is immutable';
        END;
        $prevent_data_export_job_event_mutation$ LANGUAGE plpgsql;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_log_block_mutation()
        RETURNS trigger AS $audit_log_block_mutation$
        BEGIN
          RAISE EXCEPTION 'audit_log is append-only; % is not allowed', TG_OP;
        END;
        $audit_log_block_mutation$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION pii_export_events_block_mutation()
        RETURNS trigger AS $pii_export_events_block_mutation$
        BEGIN
          RAISE EXCEPTION 'pii_export_events is append-only; % is not allowed', TG_OP;
        END;
        $pii_export_events_block_mutation$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_data_export_job_event_mutation()
        RETURNS trigger AS $prevent_data_export_job_event_mutation$
        BEGIN
          RAISE EXCEPTION 'data_export_job_event is immutable';
        END;
        $prevent_data_export_job_event_mutation$ LANGUAGE plpgsql;
    `);
  }
}
