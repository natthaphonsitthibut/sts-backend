/**
 * Build a Thai home address string from a raw `student_term` row (original
 * column names, e.g. from `SELECT s.*`). Lets visit-home forms prefill the
 * student's stored address instead of capturing the creator's GPS. Mirrors the
 * format used by the absence-monitor case address.
 */
function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value).trim();
  }
  return '';
}

export function buildStudentTermAddress(row: Record<string, unknown>): string {
  const parts: string[] = [];

  const village = text(row['VillageNumber_Onec']);
  const soi = text(row['Soi_Onec']);
  const street = text(row['Street_Onec']);
  const subDistrict = text(row['SubDistrictNameThai_Onec']);
  const district = text(row['DistrictNameThai_Onec']);
  const province = text(row['ProvinceNameThai_Onec']);

  if (village) parts.push(`หมู่ ${village}`);
  if (soi) parts.push(`ซอย${soi}`);
  if (street) parts.push(`ถนน${street}`);
  if (subDistrict) parts.push(`ตำบล/แขวง${subDistrict}`);
  if (district) parts.push(`อำเภอ/เขต${district}`);
  if (province) parts.push(`จังหวัด${province}`);

  return parts.join(' ');
}
