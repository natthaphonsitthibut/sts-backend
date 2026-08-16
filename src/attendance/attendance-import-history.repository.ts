import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { queryDataSource } from '../database/sql-query';

export interface AttendanceImportFileRow extends Record<string, unknown> {
  id: string;
  attendance_date: string;
  file_name: string;
  storage_key: string | null;
  source_url: string | null;
  row_count: number;
  applied_count: number;
  imported_by_name: string;
  imported_at: string | Date;
  subject_name: string | null;
  timetable_slot_period: number | null;
  total_count: number;
}

export interface RecordAttendanceImportInput {
  schoolId: number;
  schoolTermId: number;
  classroomId: number;
  attendanceDate: string;
  timetableSlotId: number | null;
  subjectId: number | null;
  fileName: string;
  fileSizeBytes: number | null;
  storageKey: string | null;
  sourceUrl: string | null;
  rowCount: number;
  appliedCount: number;
  importedBy: number | null;
  importedByLabel: string;
}

/** Provenance of every applied attendance import, for ประวัติ → นำเข้าไฟล์. */
@Injectable()
export class AttendanceImportHistoryRepository {
  constructor(private readonly dataSource: DataSource) {}

  async record(input: RecordAttendanceImportInput): Promise<{ id: string }> {
    const result = await queryDataSource<{ id: string }>(
      this.dataSource,
      `
        INSERT INTO attendance_import_files (
          school_id, school_term_id, classroom_id, attendance_date,
          timetable_slot_id, subject_id, file_name, file_size_bytes,
          storage_key, source_url, row_count, applied_count,
          imported_by, imported_by_label
        )
        VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING id::text
      `,
      [
        input.schoolId,
        input.schoolTermId,
        input.classroomId,
        input.attendanceDate,
        input.timetableSlotId,
        input.subjectId,
        input.fileName,
        input.fileSizeBytes,
        input.storageKey,
        input.sourceUrl,
        input.rowCount,
        input.appliedCount,
        input.importedBy,
        input.importedByLabel,
      ],
    );
    return result.rows[0];
  }

  async list(input: {
    classroomId: number;
    subjectId?: number;
    attendanceDate?: string;
    search?: string;
    sortBy?: 'attendanceDate' | 'importedBy' | 'importedAt';
    sortDirection?: 'asc' | 'desc';
    page: number;
    limit: number;
  }): Promise<AttendanceImportFileRow[]> {
    const params: unknown[] = [input.classroomId];
    const conditions = ['import_file.classroom_id = $1', 'import_file.deleted_at IS NULL'];
    if (input.subjectId) {
      params.push(input.subjectId);
      conditions.push(`import_file.subject_id = $${params.length}`);
    }
    if (input.attendanceDate) {
      params.push(input.attendanceDate);
      conditions.push(`import_file.attendance_date = $${params.length}::date`);
    }
    if (input.search) {
      params.push(`%${input.search}%`);
      conditions.push(
        `(import_file.file_name ILIKE $${params.length}
          OR import_file.imported_by_label ILIKE $${params.length})`,
      );
    }
    const sortColumn =
      {
        attendanceDate: 'import_file.attendance_date',
        importedBy: 'import_file.imported_by_label',
        importedAt: 'import_file.imported_at',
      }[input.sortBy ?? 'attendanceDate'] ?? 'import_file.attendance_date';
    const direction = input.sortDirection === 'asc' ? 'ASC' : 'DESC';
    params.push(input.limit, (input.page - 1) * input.limit);
    const result = await queryDataSource<AttendanceImportFileRow>(
      this.dataSource,
      `
        SELECT
          import_file.id::text,
          import_file.attendance_date::text,
          import_file.file_name,
          import_file.storage_key,
          import_file.source_url,
          import_file.row_count,
          import_file.applied_count,
          -- Prefer the person's real name; the stored label is the fallback for
          -- imports made through a link, where there is no account row.
          COALESCE(
            NULLIF(TRIM(COALESCE(teacher.first_name, '') || ' ' ||
                        COALESCE(teacher.last_name, '')), ''),
            NULLIF(TRIM(COALESCE(importer."FirstName", '') || ' ' ||
                        COALESCE(importer."LastName", '')), ''),
            NULLIF(import_file.imported_by_label, ''),
            '-'
          ) AS imported_by_name,
          import_file.imported_at,
          subject.name_th AS subject_name,
          timetable_slot.period AS timetable_slot_period,
          COUNT(*) OVER()::int AS total_count
        FROM attendance_import_files import_file
        LEFT JOIN subjects subject ON subject.id = import_file.subject_id
        LEFT JOIN timetable_slots timetable_slot
          ON timetable_slot.id = import_file.timetable_slot_id
        LEFT JOIN users importer ON importer.id = import_file.imported_by
        LEFT JOIN school_teacher_memberships importer_membership
          ON importer_membership.teacher_user_id = importer.id
         AND importer_membership.school_id = import_file.school_id
         AND importer_membership.deleted_at IS NULL
        LEFT JOIN teachers teacher ON teacher.id = importer_membership.teacher_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY ${sortColumn} ${direction}, import_file.imported_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params,
    );
    return result.rows;
  }

  /** Read one row for a download, keeping the classroom check in the query. */
  async findForDownload(
    id: number,
    classroomId: number,
  ): Promise<{ file_name: string; storage_key: string | null; source_url: string | null } | null> {
    const result = await queryDataSource<{
      file_name: string;
      storage_key: string | null;
      source_url: string | null;
    }>(
      this.dataSource,
      `
        SELECT file_name, storage_key, source_url
        FROM attendance_import_files
        WHERE id = $1 AND classroom_id = $2 AND deleted_at IS NULL
      `,
      [id, classroomId],
    );
    return result.rows[0] ?? null;
  }
}
