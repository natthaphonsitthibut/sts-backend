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
  email: string | null;
  gender: string | null;
  verification_method: string;
  thaid_person_ref: string | null;
  id_card_photo_filename: string | null;
  id_card_photo_uploaded_at: Date | string | null;
  campaign_id: string | null;
  campaign_name?: string | null;
  reviewed_by_user_id: number | null;
  reviewed_at: Date | string | null;
  verified_by_user_id: number | null;
  verified_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  total_count?: number | string;
}
