import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supplies a minimal official national referral directory so the reviewed
 * referral action is usable immediately. This changes reference data only;
 * schema, API, authorization, and scope contracts remain unchanged.
 */
export class SeedReferralAgencyDirectory20260827305000 implements MigrationInterface {
  name = 'SeedReferralAgencyDirectory20260827305000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $referral_directory_guard$
      BEGIN
        IF to_regclass('public.referral_agency_kinds') IS NULL
           OR to_regclass('public.referral_agencies') IS NULL
           OR to_regclass('public.case_referrals') IS NULL THEN
          RAISE EXCEPTION 'referral directory prerequisite is missing';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM referral_agency_kinds expected
          RIGHT JOIN (
            VALUES
              ('LEARNING_PROMOTION'),
              ('PUBLIC_HOSPITAL'),
              ('CHILD_FOUNDATION'),
              ('OTHER')
          ) target(code) ON target.code = expected.code
          WHERE expected.code IS NULL OR expected.is_active = FALSE
        ) THEN
          RAISE EXCEPTION 'referral agency kind prerequisite is missing or inactive';
        END IF;

        IF EXISTS (
          SELECT agency_name
          FROM referral_agencies
          WHERE agency_name IN (
            'กรมส่งเสริมการเรียนรู้',
            'สถาบันสุขภาพเด็กแห่งชาติมหาราชินี',
            'มูลนิธิศูนย์พิทักษ์สิทธิเด็ก',
            'กรมกิจการเด็กและเยาวชน'
          )
          GROUP BY agency_name
          HAVING COUNT(*) > 0
        ) THEN
          RAISE EXCEPTION 'referral agency baseline collides with an existing exact name';
        END IF;
      END
      $referral_directory_guard$
    `);

    await queryRunner.query(`
      INSERT INTO referral_agencies (agency_name, agency_kind_code)
      VALUES
        ('กรมส่งเสริมการเรียนรู้', 'LEARNING_PROMOTION'),
        ('สถาบันสุขภาพเด็กแห่งชาติมหาราชินี', 'PUBLIC_HOSPITAL'),
        ('มูลนิธิศูนย์พิทักษ์สิทธิเด็ก', 'CHILD_FOUNDATION'),
        ('กรมกิจการเด็กและเยาวชน', 'OTHER')
    `);

    await queryRunner.query(`
      DO $referral_directory_verify$
      BEGIN
        IF (
          SELECT COUNT(*)
          FROM referral_agencies
          WHERE agency_name IN (
            'กรมส่งเสริมการเรียนรู้',
            'สถาบันสุขภาพเด็กแห่งชาติมหาราชินี',
            'มูลนิธิศูนย์พิทักษ์สิทธิเด็ก',
            'กรมกิจการเด็กและเยาวชน'
          )
            AND is_active = TRUE
        ) <> 4 THEN
          RAISE EXCEPTION 'referral agency directory did not converge to four active rows';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM referral_agencies agency
          JOIN (
            VALUES
              ('กรมส่งเสริมการเรียนรู้', 'LEARNING_PROMOTION'),
              ('สถาบันสุขภาพเด็กแห่งชาติมหาราชินี', 'PUBLIC_HOSPITAL'),
              ('มูลนิธิศูนย์พิทักษ์สิทธิเด็ก', 'CHILD_FOUNDATION'),
              ('กรมกิจการเด็กและเยาวชน', 'OTHER')
          ) expected(agency_name, agency_kind_code)
            ON expected.agency_name = agency.agency_name
          WHERE agency.agency_kind_code <> expected.agency_kind_code
             OR agency.contact_phone IS NOT NULL
             OR agency.contact_email IS NOT NULL
             OR agency.website_url IS NOT NULL
        ) THEN
          RAISE EXCEPTION 'referral agency directory contains an unexpected kind or contact value';
        END IF;
      END
      $referral_directory_verify$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $referral_directory_rollback$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM case_referrals referral
          JOIN referral_agencies agency ON agency.id = referral.referral_agency_id
          WHERE agency.agency_name IN (
            'กรมส่งเสริมการเรียนรู้',
            'สถาบันสุขภาพเด็กแห่งชาติมหาราชินี',
            'มูลนิธิศูนย์พิทักษ์สิทธิเด็ก',
            'กรมกิจการเด็กและเยาวชน'
          )
        ) THEN
          RAISE EXCEPTION 'refusing rollback: referral history uses the seeded directory';
        END IF;

        DELETE FROM referral_agencies
        WHERE agency_name IN (
          'กรมส่งเสริมการเรียนรู้',
          'สถาบันสุขภาพเด็กแห่งชาติมหาราชินี',
          'มูลนิธิศูนย์พิทักษ์สิทธิเด็ก',
          'กรมกิจการเด็กและเยาวชน'
        );
      END
      $referral_directory_rollback$
    `);
  }
}
