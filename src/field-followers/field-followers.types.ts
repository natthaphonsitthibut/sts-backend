import type { FieldFollowerStatus } from './dto/field-followers.dto';

export interface FieldFollowerRow extends Record<string, unknown> {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  sub_district: string | null;
  district: string | null;
  province: string | null;
  status: FieldFollowerStatus;
  trust_level: string;
  applied_via: string;
  campaign_id: string | null;
  campaign_name?: string | null;
  reviewed_by_user_id: number | null;
  reviewed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  total_count?: number | string;
}
