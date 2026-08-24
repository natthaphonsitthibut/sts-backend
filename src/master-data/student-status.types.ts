export const STUDENT_STATUS_CATEGORIES = [
  'STUDYING',
  'SUSPENDED',
  'GRADUATED',
  'TRANSFERRED',
  'WITHDRAWN',
  'DISCHARGED',
  'DECEASED',
  'UNMATCHED',
] as const;

export type StudentStatusCategory = (typeof STUDENT_STATUS_CATEGORIES)[number];

export const STUDENT_STATUS_BADGE_VARIANTS = [
  'default',
  'secondary',
  'destructive',
  'success',
  'warning',
] as const;
export type StudentStatusBadgeVariant = (typeof STUDENT_STATUS_BADGE_VARIANTS)[number];

export const STUDENT_STATUS_SORT_FIELDS = ['code', 'labelTh', 'category', 'sortOrder'] as const;
export type StudentStatusSortField = (typeof STUDENT_STATUS_SORT_FIELDS)[number];

export interface StudentStatusRow extends Record<string, unknown> {
  code: number;
  label_th: string;
  category: StudentStatusCategory;
  badge_variant: StudentStatusBadgeVariant;
  is_active_for_login: boolean;
  is_terminal: boolean;
  requires_followup: boolean;
  is_enabled: boolean;
  sort_order: number;
  source_system: string;
  usage_count: number;
}
