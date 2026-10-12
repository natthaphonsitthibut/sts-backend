import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The visitor names the channel when choosing ช่องทางอื่น; legacy reports stay unchanged. */
export class AddContactChannelDetail20261012130000 implements MigrationInterface {
  name = 'AddContactChannelDetail20261012130000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE task_submissions
        ADD COLUMN contact_channel_detail VARCHAR(200),
        ADD CONSTRAINT chk_task_submissions_contact_channel_detail CHECK (
          contact_channel_detail IS NULL OR (
            contact_channel_code IS NOT DISTINCT FROM 'OTHER'
            AND char_length(btrim(contact_channel_detail)) BETWEEN 1 AND 200
          )
        )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      LOCK TABLE task_submissions IN ACCESS EXCLUSIVE MODE;
      DO $rollback_guard$
      BEGIN
        IF EXISTS (SELECT 1 FROM task_submissions WHERE contact_channel_detail IS NOT NULL) THEN
          RAISE EXCEPTION 'refusing rollback: reports contain other contact channel details';
        END IF;
      END
      $rollback_guard$
    `);
    await queryRunner.query(`
      ALTER TABLE task_submissions
        DROP CONSTRAINT chk_task_submissions_contact_channel_detail,
        DROP COLUMN contact_channel_detail
    `);
  }
}
