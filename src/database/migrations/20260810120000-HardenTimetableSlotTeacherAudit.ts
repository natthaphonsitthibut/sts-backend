import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Adds the missing audit-user FK for databases that already ran the slot migration. */
export class HardenTimetableSlotTeacherAudit20260810120000 implements MigrationInterface {
  name = 'HardenTimetableSlotTeacherAudit20260810120000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE timetable_slot_teachers slot_teacher
      SET created_by = NULL
      WHERE created_by IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM users actor WHERE actor.id = slot_teacher.created_by
        );

      DO $constraint$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'fk_timetable_slot_teachers_created_by'
        ) THEN
          ALTER TABLE timetable_slot_teachers
            ADD CONSTRAINT fk_timetable_slot_teachers_created_by
            FOREIGN KEY (created_by) REFERENCES users(id)
            ON DELETE SET NULL ON UPDATE CASCADE;
        END IF;
      END $constraint$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE timetable_slot_teachers
        DROP CONSTRAINT IF EXISTS fk_timetable_slot_teachers_created_by;
    `);
  }
}
