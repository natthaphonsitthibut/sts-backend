export interface FieldMonitorMapRow extends Record<string, unknown> {
  student_uuid: string;
  student_name: string;
  school_name: string | null;
  risk_tier: string;
  student_lat: number | null;
  student_lng: number | null;
  // Geocode-fallback address columns — populated by the repository, not yet
  // consumed by the service (WIP, see TASKS.md "Geocode fallback"). Optional
  // so existing rows/fixtures built before this addition still typecheck.
  address_house_no?: string | null;
  VillageNumber_Onec?: string | null;
  Trok_Onec?: string | null;
  Soi_Onec?: string | null;
  Street_Onec?: string | null;
  SubDistrictNameThai_Onec?: string | null;
  DistrictNameThai_Onec?: string | null;
  ProvinceNameThai_Onec?: string | null;
  PostalCode_Onec?: string | null;
}
