import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Opening a case copied the student's saved home pin through a normaliser that
 * turned an empty coordinate into 0 (`Number('')`), so a student without a pin
 * gave the case one at 0,0 — in the sea off West Africa. No school here is
 * there, so 0,0 is never a real pin: it goes back to "no pin", and the case map
 * falls back to the student's saved or approximate location like the profile.
 *
 * Data only. `down()` is a no-op: 0,0 was never a value anyone chose.
 */
export class ClearZeroCaseHomePins20260929100000 implements MigrationInterface {
  name = 'ClearZeroCaseHomePins20260929100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE cases
      SET student_lat = NULL, student_lng = NULL
      WHERE student_lat = 0 AND student_lng = 0
    `);
  }

  public down(queryRunner: QueryRunner): Promise<void> {
    void queryRunner;
    return Promise.resolve();
  }
}
