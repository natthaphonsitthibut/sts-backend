import type { MigrationInterface, QueryRunner } from 'typeorm';

const TYPE_CODE = 'CASE_RISK_ESCALATED';

export class AddCaseRiskEscalatedNotification20260707250000 implements MigrationInterface {
  name = 'AddCaseRiskEscalatedNotification20260707250000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      INSERT INTO notification_types (code, label_th, required_permission, sort_order)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (code) DO NOTHING
    `,
      [TYPE_CODE, 'เคสถูกยกระดับความเสี่ยง', 'review-cases', 150],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM notifications WHERE type_code = $1`, [TYPE_CODE]);
    await queryRunner.query(`DELETE FROM notification_types WHERE code = $1`, [TYPE_CODE]);
  }
}
