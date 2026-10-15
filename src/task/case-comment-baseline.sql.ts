/** Correlated on student alias s; old observations remain history across enrollments. */
export const CASE_COMMENT_COMPLETION_BASELINE_SQL = `
  SELECT MAX(COALESCE(latest_close.reviewed_at, closed_case.updated_at)) AS completed_at
  FROM cases closed_case
  JOIN student_term closed_student ON closed_student.student_uuid = closed_case.student_uuid
  LEFT JOIN LATERAL (
    SELECT review.reviewed_at FROM case_reviews review
    WHERE review.case_id = closed_case.id AND review.review_action = 'CLOSE'
    ORDER BY review.reviewed_at DESC, review.id DESC LIMIT 1
  ) latest_close ON TRUE
  WHERE closed_student.person_uuid = s.person_uuid
    AND closed_case.status = 'RESOLVED' AND closed_case.deleted_at IS NULL
`;

/**
 * When a student's เฝ้าระวัง was last decided — a case closed, or the watch
 * itself closed without a case (owner, 2026-10-15). Comments after it are the
 * ones still waiting for a decision. Correlated on student alias s, across
 * every enrollment of the same person.
 */
export const WATCH_RESET_BASELINE_SQL = `
  SELECT GREATEST(
    (${CASE_COMMENT_COMPLETION_BASELINE_SQL}),
    (
      SELECT MAX(closure.closed_at)
      FROM student_watch_closures closure
      JOIN student_term closed_student ON closed_student.student_uuid = closure.student_uuid
      WHERE closed_student.person_uuid = s.person_uuid
    )
  ) AS reset_at
`;
