import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets the access log's `ON DELETE SET NULL` actor references actually fire.
 *
 * `pii_access_events` is append-only: a trigger raises on every UPDATE and
 * DELETE. But both actor columns are declared `ON DELETE SET NULL`
 * (`actor_user_id` → `users`, `actor_teacher_membership_id` →
 * `school_teacher_memberships`), and a referential action *is* an UPDATE — so
 * the trigger refused it and deleting either parent row failed with
 * "pii_access_events is append-only; UPDATE is not allowed". The declared
 * behaviour could never happen; `RemoveTeacherUserAccounts` had to drop the
 * trigger by hand to get around it.
 *
 * The guard now allows exactly that one write and nothing else: it must come
 * from inside another trigger (a referential action runs nested; a statement
 * from the app runs at depth 1), every other column must be byte-identical, and
 * an actor reference may only go from set to NULL — never the other way, which
 * would let someone pin an access on a different person. DELETE stays blocked
 * outright: the evidence that an access happened never goes away, only the
 * pointer to a parent row that no longer exists.
 */
export class AllowPiiAccessActorRelease20260828110000 implements MigrationInterface {
  name = 'AllowPiiAccessActorRelease20260828110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION pii_access_events_block_mutation()
        RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'UPDATE'
            AND pg_trigger_depth() > 1
            AND (to_jsonb(NEW) - 'actor_user_id' - 'actor_teacher_membership_id')
              = (to_jsonb(OLD) - 'actor_user_id' - 'actor_teacher_membership_id')
            AND (NEW.actor_user_id IS NULL OR NEW.actor_user_id = OLD.actor_user_id)
            AND (
              NEW.actor_teacher_membership_id IS NULL
              OR NEW.actor_teacher_membership_id = OLD.actor_teacher_membership_id
            )
          THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'pii_access_events is append-only; % is not allowed', TG_OP;
        END;
        $$ LANGUAGE plpgsql;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION pii_access_events_block_mutation()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'pii_access_events is append-only; % is not allowed', TG_OP;
        END;
        $$ LANGUAGE plpgsql;
    `);
  }
}
