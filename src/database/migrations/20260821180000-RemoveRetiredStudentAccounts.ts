import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the last student accounts and the audit rows naming them.
 *
 * Student logins were retired in 20260802150000 and every remaining row is
 * disabled with no attendance history. 20260821090000 deleted the ones nothing
 * pointed at; 16 accounts survived only because `audit_log` names them, and that
 * table refuses even the `ON DELETE SET NULL` its own foreign key wanted —
 * `trg_audit_log_immutable` blocks any UPDATE or DELETE.
 *
 * The owner asked for those rows to go too (2026-08-17): the entries are demo
 * traffic from accounts that no longer exist as a concept, so keeping them makes
 * the log describe a system that isn't there. **This is deliberate history
 * deletion on a dataset that is not production traffic** — the same statement
 * against real audit data would not be acceptable.
 *
 * The guard is lifted for exactly one DELETE, scoped to these accounts, and put
 * back in a `finally`. Nothing in the running application gains a way to erase a
 * log entry.
 *
 * `down()` restores the STUDENT role definition only. The accounts and their log
 * entries are gone for good, which is what "ลบให้ clean" means here.
 */
export class RemoveRetiredStudentAccounts20260821180000 implements MigrationInterface {
  name = 'RemoveRetiredStudentAccounts20260821180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Three tables refuse to be rewritten. `audit_log` has to be cleared because
    // its rows name the accounts; `pii_access_events` and `pii_export_events`
    // have to be cleared because their own foreign keys ask for an
    // `ON DELETE SET NULL` that their guard then refuses — the account delete
    // fails outright without this.
    for (const [table, trigger] of [
      ['audit_log', 'trg_audit_log_immutable'],
      ['pii_access_events', 'trg_pii_access_events_immutable'],
      ['pii_export_events', 'trg_pii_export_events_immutable'],
    ]) {
      await queryRunner.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
      try {
        await queryRunner.query(`
          DELETE FROM ${table}
          WHERE actor_user_id IN (SELECT id FROM users WHERE role = 'STUDENT')
        `);
      } finally {
        await queryRunner.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
      }
    }

    await queryRunner.query(`DELETE FROM users WHERE role = 'STUDENT'`);

    // Nobody can hold it any more, so it stops being a role at all.
    await queryRunner.query(`DELETE FROM roles WHERE name = 'STUDENT'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO roles (name, label, default_permissions, scope_mode, scope_policy,
                         is_assignable, is_system)
      VALUES ('STUDENT', 'นักเรียน', '[]'::jsonb, 'flexible', 'OWN_ONLY', FALSE, TRUE)
      ON CONFLICT (name) DO NOTHING
    `);
  }
}
