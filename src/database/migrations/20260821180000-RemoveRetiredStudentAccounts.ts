import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes the last student accounts while retaining immutable history.
 *
 * Student logins were retired in 20260802150000 and every remaining row is
 * disabled with no attendance history. 20260821090000 deleted the ones nothing
 * pointed at; 16 accounts survived only because `audit_log` names them, and that
 * table refuses even the `ON DELETE SET NULL` its own foreign key wanted —
 * `trg_audit_log_immutable` blocks any UPDATE or DELETE.
 *
 * The immutable audit/PII triggers conflict with the foreign keys' intentional
 * `ON DELETE SET NULL`. They are suspended only while the account DELETE lets
 * PostgreSQL clear actor_user_id; the history rows themselves stay intact.
 *
 * `down()` restores the STUDENT role definition only. Deleted login accounts
 * cannot be reconstructed, but their audit/PII history remains available.
 */
export class RemoveRetiredStudentAccounts20260821180000 implements MigrationInterface {
  name = 'RemoveRetiredStudentAccounts20260821180000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Three immutable tables refuse the `ON DELETE SET NULL` update requested by
    // their own actor FK. Suspend only those guards while PostgreSQL nulls the
    // actor reference; never delete the history rows.
    const immutableHistoryTriggers = [
      ['audit_log', 'trg_audit_log_immutable'],
      ['pii_access_events', 'trg_pii_access_events_immutable'],
      ['pii_export_events', 'trg_pii_export_events_immutable'],
    ] as const;
    for (const [table, trigger] of immutableHistoryTriggers) {
      await queryRunner.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    }
    try {
      await queryRunner.query(`DELETE FROM users WHERE role = 'STUDENT'`);
    } finally {
      for (const [table, trigger] of [...immutableHistoryTriggers].reverse()) {
        await queryRunner.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
      }
    }

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
