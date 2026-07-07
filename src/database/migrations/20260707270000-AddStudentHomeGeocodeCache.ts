import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStudentHomeGeocodeCache20260707270000 implements MigrationInterface {
  name = 'AddStudentHomeGeocodeCache20260707270000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS student_home_geocode_cache (
        student_uuid UUID PRIMARY KEY
          CONSTRAINT fk_student_home_geocode_cache_student
          REFERENCES student_term(student_uuid) ON DELETE CASCADE ON UPDATE CASCADE,
        lat NUMERIC(10,7) NOT NULL,
        lng NUMERIC(10,7) NOT NULL,
        source_address_text TEXT NOT NULL,
        geocoded_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS student_home_geocode_cache`);
  }
}
