import type { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceNumericClassroomRoomCodes20260719110000 implements MigrationInterface {
  name = 'EnforceNumericClassroomRoomCodes20260719110000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $numeric_room_codes$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM school_classrooms
          WHERE NOT (
            room_code ~ '^[1-9][0-9]*$'
            AND (
              length(room_code) < 10
              OR (length(room_code) = 10 AND room_code <= '2147483647')
            )
          )
        ) THEN
          RAISE EXCEPTION 'school_classrooms.room_code contains a non-positive or out-of-range integer';
        END IF;
      END;
      $numeric_room_codes$
    `);

    await queryRunner.query(`
      UPDATE school_classrooms
      SET legacy_room_number = room_code::integer
      WHERE legacy_room_number IS DISTINCT FROM room_code::integer
    `);
    await queryRunner.query(`
      ALTER TABLE school_classrooms
        ALTER COLUMN legacy_room_number SET NOT NULL,
        DROP CONSTRAINT chk_school_classrooms_room_code,
        DROP CONSTRAINT chk_school_classrooms_legacy_room,
        ADD CONSTRAINT chk_school_classrooms_room_code
          CHECK (
            room_code ~ '^[1-9][0-9]*$'
            AND (
              length(room_code) < 10
              OR (length(room_code) = 10 AND room_code <= '2147483647')
            )
          ),
        ADD CONSTRAINT chk_school_classrooms_legacy_room
          CHECK (legacy_room_number::text = room_code)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE school_classrooms
        DROP CONSTRAINT chk_school_classrooms_room_code,
        DROP CONSTRAINT chk_school_classrooms_legacy_room,
        ALTER COLUMN legacy_room_number DROP NOT NULL,
        ADD CONSTRAINT chk_school_classrooms_room_code
          CHECK (length(trim(room_code)) > 0),
        ADD CONSTRAINT chk_school_classrooms_legacy_room
          CHECK (legacy_room_number IS NULL OR legacy_room_number > 0)
    `);
  }
}
