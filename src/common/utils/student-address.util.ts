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

/**
 * Prefix a value with its Thai label unless it already carries it, so imported
 * data like "ถนนเพชรเกษม" does not become "ถนนถนนเพชรเกษม".
 */
function withPrefix(prefix: string, value: string): string {
  if (!value) return '';
  return value.startsWith(prefix) ? value : `${prefix}${value}`;
}

export function buildStudentTermAddress(row: Record<string, unknown>): string {
  const parts: string[] = [];

  const houseNo = text(row['address_house_no']);
  const village = text(row['VillageNumber_Onec']);
  const trok = text(row['Trok_Onec']);
  const soi = text(row['Soi_Onec']);
  const street = text(row['Street_Onec']);
  const subDistrict = text(row['SubDistrictNameThai_Onec']);
  const district = text(row['DistrictNameThai_Onec']);
  const province = text(row['ProvinceNameThai_Onec']);
  const postalCode = text(row['PostalCode_Onec']);

  if (houseNo) parts.push(houseNo);
  if (village) parts.push(withPrefix('หมู่ ', village));
  if (trok) parts.push(withPrefix('ตรอก', trok));
  if (soi) parts.push(withPrefix('ซอย', soi));
  if (street) parts.push(withPrefix('ถนน', street));
  // Sub-district/district/province names are self-evident and read cleanly
  // without run-together "ตำบล/แขวง" prefixes.
  if (subDistrict) parts.push(subDistrict);
  if (district) parts.push(district);
  if (province) parts.push(province);
  if (postalCode) parts.push(postalCode);

  return parts.join(' ');
}
