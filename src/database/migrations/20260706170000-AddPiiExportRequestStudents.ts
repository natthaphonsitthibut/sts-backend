import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPiiExportRequestStudents20260706170000 implements MigrationInterface {
  name = 'AddPiiExportRequestStudents20260706170000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS pii_export_request_students (
        request_id UUID NOT NULL
          CONSTRAINT fk_pii_export_request_students_request
          REFERENCES pii_export_requests(id) ON DELETE CASCADE ON UPDATE CASCADE,
        student_uuid UUID NOT NULL
          CONSTRAINT fk_pii_export_request_students_student
          REFERENCES student_term(student_uuid) ON DELETE RESTRICT ON UPDATE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (request_id, student_uuid)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_pii_export_request_students_student
        ON pii_export_request_students (student_uuid)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_pii_export_request_students_student`);
    await queryRunner.query(`DROP TABLE IF EXISTS pii_export_request_students`);
  }
}
