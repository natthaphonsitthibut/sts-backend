export const STUDENT_STATUS_CATEGORIES = [
  'ACTIVE',
  'GRADUATED',
  'WITHDRAWN',
  'TRANSFERRED',
  'DECEASED',
  'UNMAPPED',
] as const;

export type StudentStatusCategory = (typeof STUDENT_STATUS_CATEGORIES)[number];

export const STUDENT_STATUS_SORT_FIELDS = ['code', 'labelTh', 'category', 'sortOrder'] as const;
export type StudentStatusSortField = (typeof STUDENT_STATUS_SORT_FIELDS)[number];

export interface StudentStatusRow extends Record<string, unknown> {
  code: number;
  label_th: string;
  category: StudentStatusCategory;
  is_active_for_login: boolean;
  is_terminal: boolean;
  requires_followup: boolean;
  is_enabled: boolean;
  sort_order: number;
  source_system: string;
  usage_count: number;
}
