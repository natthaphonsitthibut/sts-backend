import type { DataScope } from '../auth';

export interface FollowerRecruitmentCampaignRow extends Record<string, unknown> {
  id: string;
  name: string;
  description: string | null;
  public_code: string;
  data_scope: DataScope;
  is_active: boolean;
  status: 'ACTIVE' | 'LOCKED' | 'EXPIRED' | 'SCHEDULED';
  opens_at: Date | string | null;
  closes_at: Date | string | null;
  view_count: string | number;
  created_at: Date | string;
  created_by: number | null;
  updated_at: Date | string;
  updated_by: number | null;
  deleted_at: Date | string | null;
  deleted_by: number | null;
  submission_count?: string | number;
}
