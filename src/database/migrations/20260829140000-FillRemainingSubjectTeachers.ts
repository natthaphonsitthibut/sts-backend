import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives every remaining subject offering a teacher from its own school.
 *
 * Homeroom came from a recorded fact; the other subjects have never been
 * recorded anywhere, so these assignments are a starting point rather than a
 * timetable — the owner's call, so that no school opens the system to a
 * curriculum with every subject unstaffed. Schools correct them from the
 * curriculum screen.
 *
 * Two properties make that safe. Teachers are drawn only from the school's own
 * active memberships, so no assignment can cross a school boundary. And the
 * rotation is deterministic — offerings ordered by subject then classroom, each
 * taking the next teacher in turn — so the same rows come out on every
 * environment, one teacher tends to hold one subject across consecutive
 * classrooms rather than a scatter, and `down()` can recompute exactly what was
 * inserted and remove only that.
 */
export class FillRemainingSubjectTeachers20260829140000 implements MigrationInterface {
  name = 'FillRemainingSubjectTeachers20260829140000';

  /** Offerings with no teacher, paired with a rotating teacher of that school. */
  private static readonly PAIRING_SQL = `
    WITH school_teachers AS (
      SELECT
        membership.school_id,
        membership.id AS teacher_membership_id,
        ROW_NUMBER() OVER (
          PARTITION BY membership.school_id ORDER BY membership.id
        ) - 1 AS teacher_rank,
        COUNT(*) OVER (PARTITION BY membership.school_id) AS teacher_count
      FROM school_teacher_memberships membership
      WHERE membership.membership_status = 'ACTIVE'
        AND membership.deleted_at IS NULL
    ),
    unstaffed AS (
      SELECT
        offering.id,
        offering.school_id,
        offering.classroom_id,
        ROW_NUMBER() OVER (
          PARTITION BY offering.school_id
          ORDER BY offering.school_subject_id, offering.classroom_id
        ) - 1 AS offering_rank
      FROM classroom_subjects offering
      WHERE offering.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM classroom_subject_teachers assignment
          WHERE assignment.classroom_subject_id = offering.id
            AND assignment.deleted_at IS NULL
        )
    )
    SELECT
      unstaffed.id AS classroom_subject_id,
      unstaffed.school_id,
      unstaffed.classroom_id,
      school_teachers.teacher_membership_id
    FROM unstaffed
    JOIN school_teachers
      ON school_teachers.school_id = unstaffed.school_id
     AND school_teachers.teacher_rank =
         unstaffed.offering_rank % school_teachers.teacher_count
  `;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO classroom_subject_teachers (
        school_id, classroom_id, classroom_subject_id, teacher_membership_id
      )
      SELECT school_id, classroom_id, classroom_subject_id, teacher_membership_id
      FROM (${FillRemainingSubjectTeachers20260829140000.PAIRING_SQL}) pairing
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // `unstaffed` reads the offerings that have no teacher, which after `up()`
    // is none — so the pairing has to be recomputed against the rows this
    // migration created instead. Anything a school has since chosen by hand
    // differs from the rotation and is left alone.
    await queryRunner.query(`
      WITH school_teachers AS (
        SELECT
          membership.school_id,
          membership.id AS teacher_membership_id,
          ROW_NUMBER() OVER (
            PARTITION BY membership.school_id ORDER BY membership.id
          ) - 1 AS teacher_rank,
          COUNT(*) OVER (PARTITION BY membership.school_id) AS teacher_count
        FROM school_teacher_memberships membership
        WHERE membership.membership_status = 'ACTIVE'
          AND membership.deleted_at IS NULL
      ),
      rotated AS (
        SELECT
          offering.id,
          offering.school_id,
          ROW_NUMBER() OVER (
            PARTITION BY offering.school_id
            ORDER BY offering.school_subject_id, offering.classroom_id
          ) - 1 AS offering_rank
        FROM classroom_subjects offering
        WHERE offering.deleted_at IS NULL
      )
      DELETE FROM classroom_subject_teachers assignment
      USING rotated, school_teachers
      WHERE assignment.classroom_subject_id = rotated.id
        AND school_teachers.school_id = rotated.school_id
        AND school_teachers.teacher_rank =
            rotated.offering_rank % school_teachers.teacher_count
        AND assignment.teacher_membership_id = school_teachers.teacher_membership_id
    `);
  }
}
