import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Owner decision 2026-08-25: a teacher records concern in one place —
 * `classroom_student_comments`. The parallel observation subsystem
 * (dimensions, behaviour tags, revisions, AI summaries, human risk reviews)
 * is retired. Every live observation is carried over as the comment it always
 * was: its dimension becomes the shared problem category, its concern level is
 * already the same vocabulary, and the migration refuses to run if any row
 * cannot be carried over rather than dropping a teacher's note.
 */
const RETIRED_TABLES = [
  'student_observation_risk_review_sources',
  'student_observation_risk_reviews',
  'student_observation_summary_sources',
  'student_observation_summaries',
  'student_observation_tags',
  'student_observation_revisions',
  'student_observations',
  'observation_behavior_tags',
  'observation_dimensions',
] as const;

const CONVERTIBLE_SQL = `
  SELECT
    enrollment.classroom_id,
    enrollment.person_uuid,
    COALESCE(category.code, 'OTHER') AS problem_category_code,
    COALESCE(level.code, 'NOTE') AS concern_level_code,
    left(btrim(observation.comment), 2000) AS problem_description,
    CASE WHEN membership.teacher_id IS NULL THEN observation.author_user_id END
      AS authored_by_user_id,
    membership.teacher_id AS authored_by_teacher_id,
    CASE
      WHEN membership.teacher_id IS NULL AND observation.author_user_id IS NULL
      THEN left(btrim(observation.observer_display_name), 200)
    END AS authored_by_display_name,
    observation.observed_at
  FROM student_observations observation
  JOIN student_term enrollment
    ON enrollment.student_uuid = observation.student_uuid
   AND enrollment.deleted_at IS NULL
   AND enrollment.person_uuid IS NOT NULL
   AND enrollment.classroom_id IS NOT NULL
  LEFT JOIN observation_dimensions dimension
    ON dimension.id = observation.observation_dimension_id
  LEFT JOIN classroom_student_problem_categories category
    ON category.code = dimension.code
  LEFT JOIN classroom_student_comment_concern_levels level
    ON level.code = observation.concern_level
  LEFT JOIN school_teacher_memberships membership
    ON membership.id = observation.author_teacher_membership_id
   AND membership.deleted_at IS NULL
  WHERE observation.deleted_at IS NULL
    AND btrim(COALESCE(observation.comment, '')) <> ''
    AND (
      num_nonnulls(
        CASE WHEN membership.teacher_id IS NULL THEN observation.author_user_id END,
        membership.teacher_id
      ) = 1
      OR btrim(COALESCE(observation.observer_display_name, '')) <> ''
    )
`;

export class RetireStudentObservations20260827313000 implements MigrationInterface {
  name = 'RetireStudentObservations20260827313000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $prerequisites$
      BEGIN
        IF to_regclass('public.student_observations') IS NULL
           OR to_regclass('public.classroom_student_comments') IS NULL
           OR to_regclass('public.classroom_student_comment_concern_levels') IS NULL THEN
          RAISE EXCEPTION 'student observation retirement prerequisites are missing';
        END IF;
      END
      $prerequisites$
    `);
    await queryRunner.query(`
      DO $carry_over_guard$
      DECLARE live_count INTEGER;
      DECLARE convertible_count INTEGER;
      BEGIN
        SELECT COUNT(*)::int INTO live_count
        FROM student_observations WHERE deleted_at IS NULL;
        SELECT COUNT(*)::int INTO convertible_count
        FROM (${CONVERTIBLE_SQL}) convertible;
        IF convertible_count < live_count THEN
          RAISE EXCEPTION
            'cannot carry over % of % teacher observation(s) as classroom comments',
            live_count - convertible_count, live_count;
        END IF;
      END
      $carry_over_guard$
    `);
    // An observation whose author account was already deleted keeps only the
    // name it was written under. Comments need the same fallback to hold it,
    // so the author becomes "one id, or the recorded name".
    await queryRunner.query(`
      ALTER TABLE classroom_student_comments
        ADD COLUMN authored_by_display_name VARCHAR(200),
        DROP CONSTRAINT IF EXISTS chk_classroom_student_comments_author,
        ADD CONSTRAINT chk_classroom_student_comments_author CHECK (
          num_nonnulls(authored_by_user_id, authored_by_teacher_id) = 1
          OR (
            num_nonnulls(authored_by_user_id, authored_by_teacher_id) = 0
            AND authored_by_display_name IS NOT NULL
            AND length(btrim(authored_by_display_name)) BETWEEN 1 AND 200
          )
        )
    `);
    await queryRunner.query(`
      INSERT INTO classroom_student_comments (
        classroom_id, person_uuid, problem_category_code, concern_level_code,
        problem_description, authored_by_user_id, authored_by_teacher_id,
        authored_by_display_name, created_at
      )
      SELECT classroom_id, person_uuid, problem_category_code, concern_level_code,
             problem_description, authored_by_user_id, authored_by_teacher_id,
             authored_by_display_name, observed_at
      FROM (${CONVERTIBLE_SQL}) convertible
    `);
    for (const table of RETIRED_TABLES) {
      await queryRunner.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
  }

  public async down(): Promise<void> {
    await Promise.reject(
      new Error(
        'Cannot restore the retired student observation subsystem; restore a pre-migration database backup instead.',
      ),
    );
  }
}
