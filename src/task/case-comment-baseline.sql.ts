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
