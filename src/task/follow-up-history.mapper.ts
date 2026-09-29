import type { QueryResultRow } from 'pg';

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function timestamp(value: unknown): string | Date | null {
  return typeof value === 'string' || value instanceof Date ? value : null;
}

/**
 * One past visit as the student card's history lists it. Shared by the case
 * page and the follow-up link so both read the same record the same way.
 */
export function mapFollowUpHistoryRow(row: QueryResultRow) {
  return {
    assigned_to_name: text(row.assigned_to_name),
    visited_at: timestamp(row.visited_at),
    submitted_at: timestamp(row.submitted_at),
    assignment_starts_at: timestamp(row.assignment_starts_at),
    assignment_ends_at: timestamp(row.assignment_ends_at),
    assignment_note: text(row.assignment_note),
    cause_detail: text(row.cause_detail),
    follow_up_problem_category_label: text(row.follow_up_problem_category_label),
    follow_up_problem_category_guidance: text(row.follow_up_problem_category_guidance),
    exception_label: text(row.exception_label),
  };
}
