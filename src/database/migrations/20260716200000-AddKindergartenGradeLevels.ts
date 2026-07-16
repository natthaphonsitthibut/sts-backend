import type { MigrationInterface, QueryRunner } from 'typeorm';

const KINDERGARTEN_LEVELS = [
  { id: 11, label: 'อ.1', category: 'ก่อนประถมศึกษา' },
  { id: 12, label: 'อ.2', category: 'ก่อนประถมศึกษา' },
  { id: 13, label: 'อ.3', category: 'ก่อนประถมศึกษา' },
] as const;

export class AddKindergartenGradeLevels20260716200000 implements MigrationInterface {
  name = 'AddKindergartenGradeLevels20260716200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TEMP TABLE kindergarten_grade_levels_existing_20260716 (
        grade_level_id INTEGER PRIMARY KEY
      ) ON COMMIT DROP;

      INSERT INTO kindergarten_grade_levels_existing_20260716 (grade_level_id)
      SELECT id
      FROM grade_levels
      WHERE id IN (${KINDERGARTEN_LEVELS.map((level) => level.id).join(', ')})
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM grade_levels
          WHERE (id = 11 AND trim(label) <> 'อ.1')
             OR (id = 12 AND trim(label) <> 'อ.2')
             OR (id = 13 AND trim(label) <> 'อ.3')
        ) THEN
          RAISE EXCEPTION 'grade level IDs 11-13 are already used by another catalog entry';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM grade_levels
          WHERE lower(trim(label)) IN (lower('อ.1'), lower('อ.2'), lower('อ.3'))
            AND NOT (
              (id = 11 AND lower(trim(label)) = lower('อ.1'))
              OR (id = 12 AND lower(trim(label)) = lower('อ.2'))
              OR (id = 13 AND lower(trim(label)) = lower('อ.3'))
            )
        ) THEN
          RAISE EXCEPTION 'kindergarten grade labels already exist under different IDs';
        END IF;
      END $$
    `);

    await queryRunner.query(`
      CREATE TABLE kindergarten_grade_level_seed_20260716_backup (
        grade_level_id INTEGER PRIMARY KEY
          REFERENCES grade_levels(id) ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);

    for (const level of KINDERGARTEN_LEVELS) {
      await queryRunner.query(
        `
          INSERT INTO grade_levels (id, label, category)
          VALUES ($1, $2, $3)
          ON CONFLICT (id) DO UPDATE
          SET category = EXCLUDED.category
          WHERE trim(grade_levels.label) = trim(EXCLUDED.label)
        `,
        [level.id, level.label, level.category],
      );
    }

    await queryRunner.query(`
      INSERT INTO kindergarten_grade_level_seed_20260716_backup (grade_level_id)
      SELECT level.id
      FROM grade_levels level
      WHERE level.id IN (${KINDERGARTEN_LEVELS.map((level) => level.id).join(', ')})
        AND NOT EXISTS (
          SELECT 1
          FROM kindergarten_grade_levels_existing_20260716 existing
          WHERE existing.grade_level_id = level.id
        )
    `);

    await queryRunner.query(`
      SELECT setval(
        pg_get_serial_sequence('grade_levels', 'id'),
        GREATEST((SELECT COALESCE(MAX(id), 1) FROM grade_levels), 1),
        TRUE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM grade_levels level
      USING kindergarten_grade_level_seed_20260716_backup backup
      WHERE level.id = backup.grade_level_id
        AND NOT EXISTS (
          SELECT 1 FROM student_term enrollment
          WHERE enrollment."GradeLevelID_Onec" = level.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM school_classrooms classroom
          WHERE classroom.grade_level_id = level.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM attendance_sessions session
          WHERE session.grade_level_id = level.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM timetable_slots slot
          WHERE slot.grade_level_id = level.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM student_exit_events exit_event
          WHERE exit_event.last_grade_level_id = level.id
        )
    `);
    await queryRunner.query(`DROP TABLE kindergarten_grade_level_seed_20260716_backup`);
  }
}
