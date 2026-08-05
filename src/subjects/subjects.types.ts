export interface SubjectRow extends Record<string, unknown> {
  id: number;
  code: string;
  name_th: string;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}
