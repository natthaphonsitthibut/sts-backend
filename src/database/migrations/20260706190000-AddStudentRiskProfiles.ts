import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStudentRiskProfiles20260706190000 implements MigrationInterface {
  name = 'AddStudentRiskProfiles20260706190000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS student_risk_profiles (
        student_uuid UUID PRIMARY KEY
          CONSTRAINT fk_student_risk_profiles_student
          REFERENCES student_term(student_uuid) ON DELETE CASCADE ON UPDATE CASCADE,
        school_id INTEGER NOT NULL,
        grade_level_id INTEGER NULL,
        room_id INTEGER NULL,
        academic_year INTEGER NOT NULL,
        semester INTEGER NOT NULL,
        consecutive_absent_days INTEGER NOT NULL DEFAULT 0,
        absent_days INTEGER NOT NULL DEFAULT 0,
        late_count INTEGER NOT NULL DEFAULT 0,
        school_day_count INTEGER NOT NULL DEFAULT 0,
        weighted_absence_days NUMERIC(8,2) NOT NULL DEFAULT 0,
        weighted_attendance_percent NUMERIC(5,2) NULL,
        risk_tier VARCHAR(16) NOT NULL
          CONSTRAINT chk_student_risk_profiles_tier
          CHECK (risk_tier IN ('HIGH', 'MEDIUM', 'LOW', 'WATCH', 'NORMAL')),
        risk_severity SMALLINT NOT NULL
          CONSTRAINT chk_student_risk_profiles_severity
          CHECK (risk_severity BETWEEN 0 AND 4),
        risk_score NUMERIC(10,4) NOT NULL DEFAULT 0,
        open_case_count INTEGER NOT NULL DEFAULT 0,
        latest_open_case_id INTEGER NULL
          CONSTRAINT fk_student_risk_profiles_latest_case
          REFERENCES cases(id) ON DELETE SET NULL ON UPDATE CASCADE,
        latest_open_task_id TEXT NULL
          CONSTRAINT fk_student_risk_profiles_latest_task
          REFERENCES tasks(id) ON DELETE SET NULL ON UPDATE CASCADE,
        profile_calculated_at TIMESTAMPTZ NOT NULL,
        source_updated_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_student_risk_profiles_scope
        ON student_risk_profiles (school_id, grade_level_id, room_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_student_risk_profiles_tier
        ON student_risk_profiles (risk_tier)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_student_risk_profiles_sort
        ON student_risk_profiles (risk_severity DESC, risk_score DESC, student_uuid)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_student_risk_profiles_calculated_at
        ON student_risk_profiles (profile_calculated_at)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_student_risk_profiles_term_school
        ON student_risk_profiles (academic_year, semester, school_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_attendance_risk_profile_recalc
        ON attendance (student_uuid, "AcademicYear_Onec", "Semester_Onec", "AttendanceDate" DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_cases_risk_profile_open_student
        ON cases (student_uuid, created_at DESC, id DESC)
        WHERE deleted_at IS NULL AND status <> 'RESOLVED'
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_school_calendar_days_risk_profile
        ON school_calendar_days (school_term_id, day_type, deleted_at, calendar_date)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_school_calendar_days_risk_profile`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_cases_risk_profile_open_student`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_attendance_risk_profile_recalc`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_student_risk_profiles_term_school`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_student_risk_profiles_calculated_at`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_student_risk_profiles_sort`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_student_risk_profiles_tier`);
    await queryRunner.query(`DROP INDEX IF EXISTS idx_student_risk_profiles_scope`);
    await queryRunner.query(`DROP TABLE IF EXISTS student_risk_profiles`);
  }
}
