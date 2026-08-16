import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * ประวัติการนำเข้าไฟล์การเช็กชื่อ.
 *
 * A spreadsheet import already lands in `attendance` like any other round, so
 * nothing recorded which file produced it or who uploaded it — the history tab
 * had no source to read. One row per applied import keeps that provenance: the
 * class and round it filled, who imported it, and the file itself (uploads keep
 * a storage key; a Google Sheet or Drive link keeps its URL instead).
 *
 * `ON DELETE` mirrors how the referenced rows behave elsewhere: the class and
 * term are RESTRICT because an import belongs to them, while the account that
 * did it may be deactivated and removed without erasing the import.
 */
export class AddAttendanceImportFiles20260816140000 implements MigrationInterface {
  name = 'AddAttendanceImportFiles20260816140000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS attendance_import_files (
        id BIGSERIAL PRIMARY KEY,
        school_id INT NOT NULL,
        school_term_id BIGINT NOT NULL,
        classroom_id BIGINT NOT NULL,
        attendance_date DATE NOT NULL,
        timetable_slot_id BIGINT,
        subject_id INT,
        file_name TEXT NOT NULL,
        file_size_bytes INT,
        storage_key TEXT,
        source_url TEXT,
        row_count INT NOT NULL DEFAULT 0,
        applied_count INT NOT NULL DEFAULT 0,
        imported_by INT,
        imported_by_label TEXT NOT NULL,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        deleted_at TIMESTAMPTZ,
        CONSTRAINT chk_attendance_import_files_source
          CHECK (storage_key IS NOT NULL OR source_url IS NOT NULL),
        CONSTRAINT chk_attendance_import_files_counts
          CHECK (row_count >= 0 AND applied_count >= 0 AND applied_count <= row_count),
        CONSTRAINT fk_attendance_import_files_school
          FOREIGN KEY (school_id) REFERENCES schools(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_import_files_term
          FOREIGN KEY (school_term_id) REFERENCES school_terms(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_import_files_classroom
          FOREIGN KEY (classroom_id) REFERENCES school_classrooms(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_import_files_slot
          FOREIGN KEY (timetable_slot_id) REFERENCES timetable_slots(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_import_files_subject
          FOREIGN KEY (subject_id) REFERENCES subjects(id)
          ON DELETE RESTRICT ON UPDATE CASCADE,
        CONSTRAINT fk_attendance_import_files_imported_by
          FOREIGN KEY (imported_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_attendance_import_files_classroom
        ON attendance_import_files (classroom_id, attendance_date DESC)
        WHERE deleted_at IS NULL;

      CREATE INDEX IF NOT EXISTS idx_attendance_import_files_school_recent
        ON attendance_import_files (school_id, imported_at DESC)
        WHERE deleted_at IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_attendance_import_files_school_recent;
      DROP INDEX IF EXISTS idx_attendance_import_files_classroom;
      DROP TABLE IF EXISTS attendance_import_files;
    `);
  }
}
