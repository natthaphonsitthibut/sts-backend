import type { DataScope } from '../auth';

export type PiiExportStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'DOWNLOADED'
  | 'EXPIRED'
  | 'CANCELLED';

export type PiiExportAction = 'REQUEST' | 'APPROVE' | 'REJECT' | 'DOWNLOAD' | 'EXPIRE' | 'CANCEL';

export interface PiiExportRequestRow extends Record<string, unknown> {
  id: string;
  requester_user_id: number;
  requester_username: string | null;
  requester_name: string | null;
  approver_user_id: number | null;
  approver_username: string | null;
  approver_name: string | null;
  status: PiiExportStatus;
  scope_snapshot: DataScope;
  include_full_national_id: boolean;
  reason_code: string;
  reason_note: string | null;
  row_estimate: number | null;
  download_token_hash: string | null;
  download_expires_at: Date | string | null;
  downloaded_at: Date | string | null;
  rejected_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  total_count?: number | string;
}

export interface PiiExportStudentRow extends Record<string, unknown> {
  PersonID_Onec: string | null;
  PassportNumber_Onec: string | null;
  FirstName_Onec: string | null;
  LastName_Onec: string | null;
  SchoolID_Onec: number | string | null;
  school_name: string | null;
  grade: string | null;
  RoomID_Onec: number | string | null;
  student_status_label: string | null;
  VillageNumber_Onec: string | null;
  Trok_Onec: string | null;
  Soi_Onec: string | null;
  Street_Onec: string | null;
  SubDistrictNameThai_Onec: string | null;
  DistrictNameThai_Onec: string | null;
  ProvinceNameThai_Onec: string | null;
  PostalCode_Onec: string | null;
}
