import type { MigrationInterface, QueryRunner } from 'typeorm';
import { NOTIFICATION_TABLES_SQL } from '../bootstrap-sql';

export class AddNotificationCenter20260704100000 implements MigrationInterface {
  name = 'AddNotificationCenter20260704100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(NOTIFICATION_TABLES_SQL);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS notifications`);
    await queryRunner.query(`DROP TABLE IF EXISTS notification_types`);
  }
}
