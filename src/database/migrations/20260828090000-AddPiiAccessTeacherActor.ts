import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records which teacher read a masked field when the reader came through a
 * classroom link.
 *
 * `actor_user_id` answers "who" for staff, but a teacher working from a link
 * has no user account — the link session identifies them by their school
 * membership instead. Without this column a PDPA report could only say "someone
 * holding this classroom's link", which is not an answer. `purpose_link_id`
 * (already present) carries the link the access came through.
 *
 * Nullable and `ON DELETE SET NULL` to match `actor_user_id`: an access log
 * outlives the membership row it points at, and losing the teacher reference
 * must never delete the evidence that the access happened.
 */
export class AddPiiAccessTeacherActor20260828090000 implements MigrationInterface {
  name = 'AddPiiAccessTeacherActor20260828090000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        ADD COLUMN IF NOT EXISTS actor_teacher_membership_id INTEGER NULL
    `);
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        DROP CONSTRAINT IF EXISTS pii_access_events_actor_teacher_membership_id_fkey
    `);
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        ADD CONSTRAINT pii_access_events_actor_teacher_membership_id_fkey
        FOREIGN KEY (actor_teacher_membership_id)
        REFERENCES school_teacher_memberships (id)
        ON UPDATE CASCADE
        ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pii_access_events_teacher_actor
        ON pii_access_events (actor_teacher_membership_id, created_at)
        WHERE actor_teacher_membership_id IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_pii_access_events_teacher_actor
    `);
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        DROP CONSTRAINT IF EXISTS pii_access_events_actor_teacher_membership_id_fkey
    `);
    await queryRunner.query(`
      ALTER TABLE pii_access_events
        DROP COLUMN IF EXISTS actor_teacher_membership_id
    `);
  }
}
