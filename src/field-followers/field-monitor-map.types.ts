export interface FieldMonitorMapRow extends Record<string, unknown> {
  student_uuid: string;
  student_name: string;
  school_name: string | null;
  risk_tier: string;
  student_lat: number | null;
  student_lng: number | null;
}
