import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `teacher_access_grants.step_up_policy` still offered `'THAID'` as the name of
 * the identity check a teacher link can demand, but ThaID was replaced by AraID:
 * the mock login is gone and every step-up path a link can take goes through
 * AraID or an email OTP. The value named a provider the system no longer talks to.
 *
 * Nothing has to be converted — no grant has ever carried it (`sts` and
 * `sts_smoke` are entirely `EMAIL_OTP`) — but the conversion is written anyway so
 * a database that does carry it survives the constraint swap.
 */
export class RenameThaIdStepUpToAraId20260825120000 implements MigrationInterface {
  name = 'RenameThaIdStepUpToAraId20260825120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE teacher_access_grants DROP CONSTRAINT IF EXISTS chk_teacher_access_grants_step_up
    `);
    await queryRunner.query(`
      UPDATE teacher_access_grants SET step_up_policy = 'ARAID' WHERE step_up_policy = 'THAID'
    `);
    await queryRunner.query(`
      ALTER TABLE teacher_access_grants
        ADD CONSTRAINT chk_teacher_access_grants_step_up
        CHECK (step_up_policy IN ('NONE', 'EMAIL_OTP', 'ARAID'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE teacher_access_grants DROP CONSTRAINT IF EXISTS chk_teacher_access_grants_step_up
    `);
    await queryRunner.query(`
      UPDATE teacher_access_grants SET step_up_policy = 'THAID' WHERE step_up_policy = 'ARAID'
    `);
    await queryRunner.query(`
      ALTER TABLE teacher_access_grants
        ADD CONSTRAINT chk_teacher_access_grants_step_up
        CHECK (step_up_policy IN ('NONE', 'EMAIL_OTP', 'THAID'))
    `);
  }
}
