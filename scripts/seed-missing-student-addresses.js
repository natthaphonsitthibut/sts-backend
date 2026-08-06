const { STUDENT_TERM_POSTAL_CODE_BACKFILL_SQL } = require('../dist/database/bootstrap-sql');
const dataSource = require('../dist/database/typeorm.datasource').default;

async function main() {
  await dataSource.initialize();
  try {
    const result = await dataSource.query(`
      UPDATE student_term student
      SET
        "ProvinceNameThai_Onec" = COALESCE(NULLIF(BTRIM(student."ProvinceNameThai_Onec"), ''), school.province),
        "DistrictNameThai_Onec" = COALESCE(NULLIF(BTRIM(student."DistrictNameThai_Onec"), ''), school.district),
        "SubDistrictNameThai_Onec" = COALESCE(NULLIF(BTRIM(student."SubDistrictNameThai_Onec"), ''), school.sub_district),
        "VillageNumber_Onec" = COALESCE(NULLIF(BTRIM(student."VillageNumber_Onec"), ''), '1'),
        "Street_Onec" = COALESCE(NULLIF(BTRIM(student."Street_Onec"), ''), 'ถนน' || COALESCE(NULLIF(BTRIM(school.district), ''), 'ในพื้นที่โรงเรียน')),
        "Soi_Onec" = COALESCE(NULLIF(BTRIM(student."Soi_Onec"), ''), 'ซอยใกล้โรงเรียน'),
        "PostalCode_Onec" = NULLIF(BTRIM(student."PostalCode_Onec"), '')
      FROM schools school
      WHERE school.id = student."SchoolID_Onec"
        AND student.deleted_at IS NULL
        AND (
          NULLIF(BTRIM(student."ProvinceNameThai_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."DistrictNameThai_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."SubDistrictNameThai_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."VillageNumber_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."Street_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."Soi_Onec"), '') IS NULL
          OR NULLIF(BTRIM(student."PostalCode_Onec"), '') IS NULL
        )
    `);
    await dataSource.query(STUDENT_TERM_POSTAL_CODE_BACKFILL_SQL);
    console.log(`Filled missing address fields for ${result[1] ?? 0} students without overwriting existing values.`);
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
