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

export interface FollowerCampaignTargetRow extends Record<string, unknown> {
  id: string;
  campaign_id: string;
  case_id: number;
  status: 'OPEN' | 'ASSIGNED' | 'COMPLETED' | 'CANCELED';
  assigned_follower_id: string | null;
  assigned_task_link_id: string | null;
  assigned_at: Date | string | null;
  assigned_by: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  case_student_name: string | null;
  case_student_id: string | null;
  case_student_school: string | null;
  case_student_address: string | null;
  case_reason_flagged: string | null;
  assigned_follower_name: string | null;
  assigned_follower_email: string | null;
  assigned_follower_phone: string | null;
}

export interface FollowerAssignmentCandidateRow extends Record<string, unknown> {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  status: string;
  campaign_id: string | null;
}
