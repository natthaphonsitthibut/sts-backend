import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Data fix — kindergarten classrooms were imported with room_name stamped as
 * "ห้อง อ.1/1" (grade + room restated), while every other classroom leaves
 * room_name NULL and renders as "ห้อง <room_code>". room_name is meant for a
 * real display name (e.g. ห้องวิทยาศาสตร์) only, so the derived copies go away
 * and the whole table reads in one pattern.
 */
export class ClearDerivedClassroomRoomNames20260719100000 implements MigrationInterface {
  name = 'ClearDerivedClassroomRoomNames20260719100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE school_classrooms
      SET room_name = NULL
      WHERE room_name ~ '^ห้อง\\s*อ\\.[0-9]+/[0-9]+$'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore the derived names for kindergarten rows that have none — the
    // original values were fully derivable from grade label + room_code.
    await queryRunner.query(`
      UPDATE school_classrooms classroom
      SET room_name = 'ห้อง ' || grade.label || '/' || classroom.room_code
      FROM grade_levels grade
      WHERE grade.id = classroom.grade_level_id
        AND grade.label LIKE 'อ.%'
        AND classroom.room_name IS NULL
    `);
  }
}
