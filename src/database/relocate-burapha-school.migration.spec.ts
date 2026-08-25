import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('RelocateBuraphaSchool migration', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/database/migrations/20260827313400-RelocateBuraphaSchool.ts'),
    'utf8',
  );

  it('guards the exact school identity and uses official area codes', () => {
    expect(source).toContain('const TARGET_SCHOOL_ID = 10010004');
    expect(source).toContain('WHERE id = ${TARGET_SCHOOL_ID}');
    expect(source).toContain("name = 'โรงเรียนเทพศิรินทร์ราชดำริ'");
    expect(source).toContain("province_code = '20'");
    expect(source).toContain("district_code = '2001'");
    expect(source).toContain("sub_district_code = '200104'");
  });

  it('backs up every former address and keeps Saen Suk as the majority', () => {
    expect(source).toContain('migration_20260827313400_burapha_student_address_backup');
    expect(source).toContain('FOREIGN KEY (school_id) REFERENCES schools(id)');
    expect(source).toContain('FOREIGN KEY (student_uuid) REFERENCES student_term(student_uuid)');
    expect(source).toContain('ON UPDATE CASCADE ON DELETE RESTRICT');
    expect(source).toContain('WHEN assigned.address_bucket < 7');
    expect(source).toContain('saen_suk_students * 2 <= total_students');
  });

  it('moves school-bound user scopes and restores their exact JSON on down', () => {
    expect(source).toContain('migration_20260827313400_burapha_user_scope_backup');
    expect(source).toContain('FOREIGN KEY (user_id) REFERENCES users(id)');
    expect(source).toContain('data_scope @> \'{"school_ids":[${TARGET_SCHOOL_ID}]}\'::jsonb');
    expect(source).toContain("WHEN value = 'กรุงเทพมหานคร' THEN 'ชลบุรี'");
    expect(source).toContain("WHEN value = 'ดอนเมือง' THEN 'เมืองชลบุรี'");
    expect(source).toContain("WHEN value = 'สีกัน' THEN 'แสนสุข'");
    expect(source).toContain('SET data_scope = backup.data_scope');
  });

  it('restores exact student addresses and the former school on down', () => {
    expect(source).toContain('SET "ProvinceNameThai_Onec" = backup.province_name_th');
    expect(source).toContain("province_code = '10'");
    expect(source).toContain("sub_district_code = '103602'");
  });
});
