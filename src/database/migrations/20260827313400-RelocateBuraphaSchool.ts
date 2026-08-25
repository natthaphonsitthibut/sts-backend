import type { MigrationInterface, QueryRunner } from 'typeorm';

const TARGET_SCHOOL_ID = 10010004;

/**
 * Relocates the production demo school formerly named เทพศิรินทร์ราชดำริ to
 * Chonburi. Student locations are deterministic: 70% resolve to Saen Suk and
 * the remainder to nearby sub-districts in Mueang Chonburi. A migration-only
 * backup table retains the exact former student address fields for rollback.
 */
export class RelocateBuraphaSchool20260827313400 implements MigrationInterface {
  name = 'RelocateBuraphaSchool20260827313400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $target_school_guard$
      DECLARE target_count integer;
      BEGIN
        SELECT COUNT(*) INTO target_count
        FROM schools
        WHERE id = ${TARGET_SCHOOL_ID}
          AND name = 'โรงเรียนเทพศิรินทร์ราชดำริ';

        IF target_count <> 1 THEN
          RAISE EXCEPTION
            'Expected school % to be โรงเรียนเทพศิรินทร์ราชดำริ exactly once; found %',
            ${TARGET_SCHOOL_ID}, target_count;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM student_term WHERE "SchoolID_Onec" = ${TARGET_SCHOOL_ID}
        ) THEN
          RAISE EXCEPTION 'School % has no student enrollments to relocate', ${TARGET_SCHOOL_ID};
        END IF;
      END
      $target_school_guard$
    `);

    await queryRunner.query(`
      CREATE TABLE migration_20260827313400_burapha_student_address_backup (
        student_uuid UUID PRIMARY KEY,
        school_id INTEGER NOT NULL,
        province_name_th TEXT NULL,
        district_name_th TEXT NULL,
        sub_district_name_th TEXT NULL,
        postal_code VARCHAR(20) NULL,
        CONSTRAINT chk_burapha_address_backup_school
          CHECK (school_id = ${TARGET_SCHOOL_ID}),
        CONSTRAINT fk_burapha_address_backup_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        CONSTRAINT fk_burapha_address_backup_student
          FOREIGN KEY (student_uuid) REFERENCES student_term(student_uuid)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      INSERT INTO migration_20260827313400_burapha_student_address_backup (
        student_uuid, school_id, province_name_th, district_name_th,
        sub_district_name_th, postal_code
      )
      SELECT student_uuid, "SchoolID_Onec", "ProvinceNameThai_Onec",
        "DistrictNameThai_Onec", "SubDistrictNameThai_Onec", "PostalCode_Onec"
      FROM student_term
      WHERE "SchoolID_Onec" = ${TARGET_SCHOOL_ID}
    `);

    await queryRunner.query(`
      CREATE TABLE migration_20260827313400_burapha_user_scope_backup (
        user_id INTEGER PRIMARY KEY,
        school_id INTEGER NOT NULL,
        data_scope JSONB NOT NULL,
        CONSTRAINT chk_burapha_scope_backup_school
          CHECK (school_id = ${TARGET_SCHOOL_ID}),
        CONSTRAINT fk_burapha_scope_backup_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON UPDATE CASCADE ON DELETE RESTRICT,
        CONSTRAINT fk_burapha_scope_backup_user
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON UPDATE CASCADE ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      INSERT INTO migration_20260827313400_burapha_user_scope_backup (
        user_id, school_id, data_scope
      )
      SELECT id, ${TARGET_SCHOOL_ID}, data_scope
      FROM users
      WHERE data_scope @> '{"school_ids":[${TARGET_SCHOOL_ID}]}'::jsonb
    `);

    await queryRunner.query(`
      UPDATE schools
      SET name = 'โรงเรียนบูรพา',
          province = 'ชลบุรี',
          district = 'เมืองชลบุรี',
          sub_district = 'แสนสุข',
          province_code = '20',
          district_code = '2001',
          sub_district_code = '200104',
          updated_at = NOW()
      WHERE id = ${TARGET_SCHOOL_ID}
    `);

    await queryRunner.query(`
      UPDATE users scoped_user
      SET data_scope = scoped_user.data_scope
        || CASE WHEN jsonb_typeof(scoped_user.data_scope->'provinces') = 'array'
          THEN jsonb_build_object('provinces', (
              SELECT jsonb_agg(DISTINCT CASE
                WHEN value = 'กรุงเทพมหานคร' THEN 'ชลบุรี'
                ELSE value
              END)
              FROM jsonb_array_elements_text(scoped_user.data_scope->'provinces') item(value)
            ))
          ELSE '{}'::jsonb
        END
        || CASE WHEN jsonb_typeof(scoped_user.data_scope->'districts') = 'array'
          THEN jsonb_build_object('districts', (
            SELECT jsonb_agg(DISTINCT CASE
              WHEN value = 'ดอนเมือง' THEN 'เมืองชลบุรี'
              ELSE value
            END)
            FROM jsonb_array_elements_text(scoped_user.data_scope->'districts') item(value)
          ))
          ELSE '{}'::jsonb
        END
        || CASE WHEN jsonb_typeof(scoped_user.data_scope->'sub_districts') = 'array'
          THEN jsonb_build_object('sub_districts', (
            SELECT jsonb_agg(DISTINCT CASE
              WHEN value = 'สีกัน' THEN 'แสนสุข'
              ELSE value
            END)
            FROM jsonb_array_elements_text(scoped_user.data_scope->'sub_districts') item(value)
          ))
          ELSE '{}'::jsonb
        END
      WHERE scoped_user.id IN (
        SELECT backup.user_id
        FROM migration_20260827313400_burapha_user_scope_backup backup
      )
    `);

    await queryRunner.query(`
      WITH assigned_address AS (
        SELECT student_uuid,
          MOD(
            (('x' || SUBSTR(MD5(student_uuid::text), 1, 8))::bit(32)::bigint),
            10
          ) AS address_bucket
        FROM student_term
        WHERE "SchoolID_Onec" = ${TARGET_SCHOOL_ID}
      )
      UPDATE student_term student
      SET "ProvinceNameThai_Onec" = 'ชลบุรี',
          "DistrictNameThai_Onec" = 'เมืองชลบุรี',
          "SubDistrictNameThai_Onec" = CASE
            WHEN assigned.address_bucket < 7 THEN 'แสนสุข'
            WHEN assigned.address_bucket = 7 THEN 'บ้านสวน'
            WHEN assigned.address_bucket = 8 THEN 'เสม็ด'
            ELSE 'อ่างศิลา'
          END,
          "PostalCode_Onec" = CASE
            WHEN assigned.address_bucket < 7 THEN '20130'
            ELSE '20000'
          END,
          updated_at = NOW()
      FROM assigned_address assigned
      WHERE student.student_uuid = assigned.student_uuid
    `);

    await queryRunner.query(`
      DO $relocation_verification$
      DECLARE total_students integer;
      DECLARE saen_suk_students integer;
      DECLARE invalid_students integer;
      BEGIN
        SELECT COUNT(*),
          COUNT(*) FILTER (WHERE "SubDistrictNameThai_Onec" = 'แสนสุข'),
          COUNT(*) FILTER (
            WHERE "ProvinceNameThai_Onec" <> 'ชลบุรี'
               OR "DistrictNameThai_Onec" <> 'เมืองชลบุรี'
               OR "SubDistrictNameThai_Onec" NOT IN ('แสนสุข', 'บ้านสวน', 'เสม็ด', 'อ่างศิลา')
          )
        INTO total_students, saen_suk_students, invalid_students
        FROM student_term
        WHERE "SchoolID_Onec" = ${TARGET_SCHOOL_ID};

        IF invalid_students <> 0 OR saen_suk_students * 2 <= total_students THEN
          RAISE EXCEPTION
            'Burapha relocation verification failed: total=%, Saen Suk=%, invalid=%',
            total_students, saen_suk_students, invalid_students;
        END IF;


        IF EXISTS (
          SELECT 1
          FROM users scoped_user
          JOIN migration_20260827313400_burapha_user_scope_backup backup
            ON backup.user_id = scoped_user.id
          WHERE scoped_user.data_scope->'provinces' ? 'กรุงเทพมหานคร'
             OR scoped_user.data_scope->'districts' ? 'ดอนเมือง'
             OR scoped_user.data_scope->'sub_districts' ? 'สีกัน'
        ) THEN
          RAISE EXCEPTION 'Burapha relocation left a school-scoped user on the former area';
        END IF;
      END
      $relocation_verification$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $restore_burapha_user_scope$
      BEGIN
        IF to_regclass('migration_20260827313400_burapha_user_scope_backup') IS NOT NULL THEN
          UPDATE users scoped_user
          SET data_scope = backup.data_scope
          FROM migration_20260827313400_burapha_user_scope_backup backup
          WHERE scoped_user.id = backup.user_id;
        END IF;
      END
      $restore_burapha_user_scope$
    `);
    await queryRunner.query(`
      UPDATE student_term student
      SET "ProvinceNameThai_Onec" = backup.province_name_th,
          "DistrictNameThai_Onec" = backup.district_name_th,
          "SubDistrictNameThai_Onec" = backup.sub_district_name_th,
          "PostalCode_Onec" = backup.postal_code,
          updated_at = NOW()
      FROM migration_20260827313400_burapha_student_address_backup backup
      WHERE student.student_uuid = backup.student_uuid
    `);
    await queryRunner.query(`
      UPDATE schools
      SET name = 'โรงเรียนเทพศิรินทร์ราชดำริ',
          province = 'กรุงเทพมหานคร',
          district = 'ดอนเมือง',
          sub_district = 'สีกัน',
          province_code = '10',
          district_code = '1036',
          sub_district_code = '103602',
          updated_at = NOW()
      WHERE id = ${TARGET_SCHOOL_ID}
    `);
    await queryRunner.query(
      `DROP TABLE IF EXISTS migration_20260827313400_burapha_user_scope_backup`,
    );
    await queryRunner.query(`DROP TABLE migration_20260827313400_burapha_student_address_backup`);
  }
}
