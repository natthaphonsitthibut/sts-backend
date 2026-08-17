/**
 * Shared SQL for "the students of one classroom, with what a roster screen
 * shows about them".
 *
 * The authenticated check-in roster and the teacher-link classroom roster are
 * the same list read through different gates — one scoped by the actor's
 * data_scope, the other by the grant's classroom. They drifted apart once
 * already (the authenticated side was missing หมายเหตุ and สถานะความเสี่ยง for
 * months), so the joins and the profile columns live here instead of being
 * copied per repository. Each caller still owns its own WHERE, ORDER BY and
 * paging — only the shape of a roster row is shared.
 *
 * `alias` is the `student_term` alias in the caller's query, because the two
 * repositories name it differently (`s` vs `enrollment`).
 */

/** Photo, risk profile and latest homeroom note for a `student_term` row. */
export function rosterProfileJoinsSql(alias: string): string {
  return `
      LEFT JOIN student_person person ON person.person_uuid = ${alias}.person_uuid
      LEFT JOIN student_risk_profiles risk ON risk.student_uuid = ${alias}.student_uuid
      LEFT JOIN LATERAL (
        SELECT comment.problem_description
        FROM classroom_student_comments comment
        WHERE comment.classroom_id = ${alias}.classroom_id
          AND comment.person_uuid = ${alias}.person_uuid
        ORDER BY comment.created_at DESC, comment.id DESC
        LIMIT 1
      ) latest_comment ON TRUE
    `;
}

/**
 * Columns every roster screen renders. Photo is deliberately absent: the
 * authenticated side returns a guarded URL built from the storage key while the
 * link side only exposes a boolean, so each caller projects `person` itself.
 */
export function rosterProfileColumnsSql(alias: string): string {
  return `
        ${alias}."FirstName_Onec" AS first_name,
        ${alias}."LastName_Onec" AS last_name,
        ${alias}.classroom_id,
        risk.risk_tier,
        latest_comment.problem_description AS teacher_comment
    `;
}
