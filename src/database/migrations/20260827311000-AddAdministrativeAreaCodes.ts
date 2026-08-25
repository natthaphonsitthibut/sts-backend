import type { MigrationInterface, QueryRunner } from 'typeorm';
import {
  ADMINISTRATIVE_DISTRICTS,
  ADMINISTRATIVE_PROVINCES,
  ADMINISTRATIVE_SUB_DISTRICTS,
} from '../administrative-area-catalog';

export class AddAdministrativeAreaCodes20260827311000 implements MigrationInterface {
  name = 'AddAdministrativeAreaCodes20260827311000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE administrative_provinces (
        code VARCHAR(2) PRIMARY KEY,
        name_th VARCHAR(100) NOT NULL UNIQUE,
        CONSTRAINT chk_administrative_provinces_code
          CHECK (code ~ '^[0-9]{2}$'),
        CONSTRAINT chk_administrative_provinces_name
          CHECK (name_th = BTRIM(name_th) AND CHAR_LENGTH(name_th) BETWEEN 1 AND 100)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE administrative_districts (
        code VARCHAR(4) PRIMARY KEY,
        province_code VARCHAR(2) NOT NULL,
        name_th VARCHAR(100) NOT NULL,
        CONSTRAINT chk_administrative_districts_code
          CHECK (code ~ '^[0-9]{4}$' AND LEFT(code, 2) = province_code),
        CONSTRAINT chk_administrative_districts_name
          CHECK (name_th = BTRIM(name_th) AND CHAR_LENGTH(name_th) BETWEEN 1 AND 100),
        CONSTRAINT uq_administrative_districts_code_province UNIQUE (code, province_code),
        CONSTRAINT uq_administrative_districts_name_province UNIQUE (province_code, name_th),
        CONSTRAINT fk_administrative_districts_province FOREIGN KEY (province_code)
          REFERENCES administrative_provinces(code) ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE administrative_sub_districts (
        code VARCHAR(6) PRIMARY KEY,
        district_code VARCHAR(4) NOT NULL,
        province_code VARCHAR(2) NOT NULL,
        name_th VARCHAR(100) NOT NULL,
        CONSTRAINT chk_administrative_sub_districts_code
          CHECK (
            code ~ '^[0-9]{6}$'
            AND LEFT(code, 4) = district_code
            AND LEFT(code, 2) = province_code
          ),
        CONSTRAINT chk_administrative_sub_districts_name
          CHECK (name_th = BTRIM(name_th) AND CHAR_LENGTH(name_th) BETWEEN 1 AND 100),
        CONSTRAINT uq_administrative_sub_districts_hierarchy
          UNIQUE (code, district_code, province_code),
        CONSTRAINT uq_administrative_sub_districts_name_district
          UNIQUE (district_code, name_th),
        CONSTRAINT fk_administrative_sub_districts_district FOREIGN KEY (district_code, province_code)
          REFERENCES administrative_districts(code, province_code)
          ON DELETE RESTRICT ON UPDATE CASCADE
      )
    `);

    await queryRunner.query(
      `
        INSERT INTO administrative_provinces (code, name_th)
        SELECT code, name_th
        FROM jsonb_to_recordset($1::jsonb) AS source(code VARCHAR(2), name_th VARCHAR(100))
      `,
      [
        JSON.stringify(
          ADMINISTRATIVE_PROVINCES.map(([code, nameTh]) => ({ code, name_th: nameTh })),
        ),
      ],
    );
    await queryRunner.query(
      `
        INSERT INTO administrative_districts (code, province_code, name_th)
        SELECT code, province_code, name_th
        FROM jsonb_to_recordset($1::jsonb)
          AS source(code VARCHAR(4), province_code VARCHAR(2), name_th VARCHAR(100))
      `,
      [
        JSON.stringify(
          ADMINISTRATIVE_DISTRICTS.map(([code, provinceCode, nameTh]) => ({
            code,
            province_code: provinceCode,
            name_th: nameTh,
          })),
        ),
      ],
    );
    await queryRunner.query(
      `
        INSERT INTO administrative_sub_districts (code, district_code, province_code, name_th)
        SELECT code, district_code, province_code, name_th
        FROM jsonb_to_recordset($1::jsonb) AS source(
          code VARCHAR(6),
          district_code VARCHAR(4),
          province_code VARCHAR(2),
          name_th VARCHAR(100)
        )
      `,
      [
        JSON.stringify(
          ADMINISTRATIVE_SUB_DISTRICTS.map(([code, districtCode, provinceCode, nameTh]) => ({
            code,
            district_code: districtCode,
            province_code: provinceCode,
            name_th: nameTh,
          })),
        ),
      ],
    );

    await queryRunner.query(`
      ALTER TABLE schools
        ADD COLUMN province_code VARCHAR(2),
        ADD COLUMN district_code VARCHAR(4),
        ADD COLUMN sub_district_code VARCHAR(6),
        ADD CONSTRAINT chk_schools_administrative_area_hierarchy CHECK (
          (district_code IS NULL OR province_code IS NOT NULL)
          AND (sub_district_code IS NULL OR district_code IS NOT NULL)
        ),
        ADD CONSTRAINT fk_schools_province_code FOREIGN KEY (province_code)
          REFERENCES administrative_provinces(code) ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT fk_schools_district_code FOREIGN KEY (district_code, province_code)
          REFERENCES administrative_districts(code, province_code)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        ADD CONSTRAINT fk_schools_sub_district_code
          FOREIGN KEY (sub_district_code, district_code, province_code)
          REFERENCES administrative_sub_districts(code, district_code, province_code)
          ON DELETE RESTRICT ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      CREATE INDEX idx_schools_administrative_area_codes
        ON schools (province_code, district_code, sub_district_code, id)
    `);

    await queryRunner.query(`
      UPDATE schools school
      SET province_code = province.code
      FROM administrative_provinces province
      WHERE NULLIF(BTRIM(school.province), '') IS NOT NULL
        AND REGEXP_REPLACE(BTRIM(school.province), '^จังหวัด', '') =
            REGEXP_REPLACE(province.name_th, '^จังหวัด', '')
    `);
    await queryRunner.query(`
      UPDATE schools school
      SET district_code = district.code
      FROM administrative_districts district
      WHERE school.province_code = district.province_code
        AND NULLIF(BTRIM(school.district), '') IS NOT NULL
        AND REGEXP_REPLACE(BTRIM(school.district), '^(อำเภอ|เขต)', '') =
            REGEXP_REPLACE(district.name_th, '^(อำเภอ|เขต)', '')
    `);
    await queryRunner.query(`
      UPDATE schools school
      SET sub_district_code = sub_district.code
      FROM administrative_sub_districts sub_district
      WHERE school.province_code = sub_district.province_code
        AND school.district_code = sub_district.district_code
        AND NULLIF(BTRIM(school.sub_district), '') IS NOT NULL
        AND REGEXP_REPLACE(BTRIM(school.sub_district), '^(ตำบล|แขวง)', '') =
            REGEXP_REPLACE(sub_district.name_th, '^(ตำบล|แขวง)', '')
    `);

    await queryRunner.query(`
      DO $catalog_verification$
      BEGIN
        IF (SELECT COUNT(*) FROM administrative_provinces) <> 77
           OR (SELECT COUNT(*) FROM administrative_districts) <> 928
           OR (SELECT COUNT(*) FROM administrative_sub_districts) <> 7436 THEN
          RAISE EXCEPTION 'administrative area catalog is incomplete';
        END IF;
      END
      $catalog_verification$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_schools_administrative_area_codes');
    await queryRunner.query(`
      ALTER TABLE schools
        DROP CONSTRAINT IF EXISTS fk_schools_sub_district_code,
        DROP CONSTRAINT IF EXISTS fk_schools_district_code,
        DROP CONSTRAINT IF EXISTS fk_schools_province_code,
        DROP CONSTRAINT IF EXISTS chk_schools_administrative_area_hierarchy,
        DROP COLUMN IF EXISTS sub_district_code,
        DROP COLUMN IF EXISTS district_code,
        DROP COLUMN IF EXISTS province_code
    `);
    await queryRunner.query('DROP TABLE administrative_sub_districts');
    await queryRunner.query('DROP TABLE administrative_districts');
    await queryRunner.query('DROP TABLE administrative_provinces');
  }
}
