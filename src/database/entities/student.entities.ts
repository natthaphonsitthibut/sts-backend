import { Column, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'student_term' })
@Index(
  'uq_student_term_enrollment_natural',
  ['personUuid', 'academicYearOnec', 'semesterOnec', 'schoolIdOnec'],
  { unique: true },
)
export class StudentTermEntity {
  @Column({ name: 'PersonID_Onec', type: 'text' })
  personIdOnec!: string;

  // Enrollment snapshot identifier. The same person receives a new UUID for a
  // different academic year/semester/school natural key.
  @PrimaryColumn({ name: 'student_uuid', type: 'uuid', default: () => 'gen_random_uuid()' })
  studentUuid!: string;

  @Column({ name: 'person_uuid', type: 'uuid' })
  personUuid!: string;

  @Column({ name: 'AcademicYear_Onec', type: 'integer' })
  academicYearOnec!: number;

  @Column({ name: 'Semester_Onec', type: 'integer' })
  semesterOnec!: number;

  @Column({ name: 'DepartmentID_Onec', type: 'integer', nullable: true })
  departmentIdOnec!: number | null;

  @Column({ name: 'SchoolID_Onec', type: 'integer' })
  schoolIdOnec!: number;

  @Column({ name: 'FirstName_Onec', type: 'text', nullable: true })
  firstNameOnec!: string | null;

  @Column({ name: 'MiddleName_Onec', type: 'text', nullable: true })
  middleNameOnec!: string | null;

  @Column({ name: 'LastName_Onec', type: 'text', nullable: true })
  lastNameOnec!: string | null;

  @Column({ name: 'VillageNumber_Onec', type: 'text', nullable: true })
  villageNumberOnec!: string | null;

  @Column({ name: 'Street_Onec', type: 'text', nullable: true })
  streetOnec!: string | null;

  @Column({ name: 'Soi_Onec', type: 'text', nullable: true })
  soiOnec!: string | null;

  @Column({ name: 'Trok_Onec', type: 'text', nullable: true })
  trokOnec!: string | null;

  @Column({ name: 'GradeLevelID_Onec', type: 'integer', nullable: true })
  gradeLevelIdOnec!: number | null;

  @Column({ name: 'RoomID_Onec', type: 'integer', nullable: true })
  roomIdOnec!: number | null;

  @Column({ name: 'GPAX_Onec', type: 'real', nullable: true })
  gpaxOnec!: number | null;

  @Column({ name: 'StudentStatusID_Onec', type: 'integer', nullable: true })
  studentStatusIdOnec!: number | null;

  @Column({ name: 'student_status_code', type: 'integer', nullable: true })
  studentStatusCode!: number | null;

  @Column({ name: 'ProvinceNameThai_Onec', type: 'text', nullable: true })
  provinceNameThaiOnec!: string | null;

  @Column({ name: 'DistrictNameThai_Onec', type: 'text', nullable: true })
  districtNameThaiOnec!: string | null;

  @Column({ name: 'SubDistrictNameThai_Onec', type: 'text', nullable: true })
  subDistrictNameThaiOnec!: string | null;

  @Column({ name: 'PostalCode_Onec', type: 'varchar', length: 5, nullable: true })
  postalCodeOnec!: string | null;
}

@Entity({ name: 'student_dropouts' })
export class StudentDropoutEntity {
  @PrimaryColumn({ name: 'PersonID_Onec', type: 'text' })
  personIdOnec!: string;

  // B1.1 surrogate — see StudentTermEntity.studentUuid.
  @Column({ name: 'student_uuid', type: 'uuid', unique: true, default: () => 'gen_random_uuid()' })
  studentUuid!: string;

  @Column({ name: 'ProvinceNameThai_Onec', type: 'text', nullable: true })
  provinceNameThaiOnec!: string | null;

  @Column({ name: 'DistrictNameThai_Onec', type: 'text', nullable: true })
  districtNameThaiOnec!: string | null;

  @Column({ name: 'SubDistrictNameThai_Onec', type: 'text', nullable: true })
  subDistrictNameThaiOnec!: string | null;

  @Column({ name: 'Fullname_Onec', type: 'text', nullable: true })
  fullnameOnec!: string | null;

  @Column({ name: 'SchoolName_Onec', type: 'text', nullable: true })
  schoolNameOnec!: string | null;

  @Column({ name: 'GradeLevelID_Onec', type: 'integer', nullable: true })
  gradeLevelIdOnec!: number | null;

  @Column({ name: 'RoomID_Onec', type: 'integer', nullable: true })
  roomIdOnec!: number | null;

  @Column({ name: 'SchoolID_Onec', type: 'integer', nullable: true })
  schoolIdOnec!: number | null;
}

@Entity({ name: 'attendance' })
export class AttendanceEntity {
  @PrimaryGeneratedColumn({ name: 'AttendanceID' })
  attendanceId!: number;

  @Column({ name: 'student_uuid', type: 'uuid' })
  studentUuid!: string;

  @Column({ name: 'session_id', type: 'uuid', nullable: true })
  sessionId!: string | null;

  @Column({ name: 'SchoolID_Onec', type: 'integer' })
  schoolIdOnec!: number;

  @Column({ name: 'GradeLevelID_Onec', type: 'integer' })
  gradeLevelIdOnec!: number;

  @Column({ name: 'RoomID_Onec', type: 'integer' })
  roomIdOnec!: number;

  @Column({ name: 'AcademicYear_Onec', type: 'integer' })
  academicYearOnec!: number;

  @Column({ name: 'Semester_Onec', type: 'integer' })
  semesterOnec!: number;

  @Column({ name: 'AttendanceDate', type: 'date' })
  attendanceDate!: string;

  @Column({ name: 'Period', type: 'integer' })
  period!: number;

  @Column({ name: 'AttendanceStatus', type: 'smallint' })
  attendanceStatus!: number;

  @Column({ name: 'RecordedAt', type: 'timestamptz', nullable: true })
  recordedAt!: Date | null;

  @Column({ name: 'RecordedBy', type: 'varchar', length: 100, nullable: true })
  recordedBy!: string | null;
}

@Entity({ name: 'student_risk_profiles' })
@Index('idx_student_risk_profiles_scope', ['schoolId', 'gradeLevelId', 'roomId'])
@Index('idx_student_risk_profiles_tier', ['riskTier'])
@Index('idx_student_risk_profiles_sort', ['riskSeverity', 'riskScore', 'studentUuid'])
@Index('idx_student_risk_profiles_calculated_at', ['profileCalculatedAt'])
@Index('idx_student_risk_profiles_term_school', ['academicYear', 'semester', 'schoolId'])
export class StudentRiskProfileEntity {
  @PrimaryColumn({ name: 'student_uuid', type: 'uuid' })
  studentUuid!: string;

  @Column({ name: 'school_id', type: 'integer' })
  schoolId!: number;

  @Column({ name: 'grade_level_id', type: 'integer', nullable: true })
  gradeLevelId!: number | null;

  @Column({ name: 'room_id', type: 'integer', nullable: true })
  roomId!: number | null;

  @Column({ name: 'academic_year', type: 'integer' })
  academicYear!: number;

  @Column({ name: 'semester', type: 'integer' })
  semester!: number;

  @Column({ name: 'consecutive_absent_days', type: 'integer', default: 0 })
  consecutiveAbsentDays!: number;

  @Column({ name: 'absent_days', type: 'integer', default: 0 })
  absentDays!: number;

  @Column({ name: 'late_count', type: 'integer', default: 0 })
  lateCount!: number;

  @Column({ name: 'school_day_count', type: 'integer', default: 0 })
  schoolDayCount!: number;

  @Column({
    name: 'weighted_absence_days',
    type: 'numeric',
    precision: 8,
    scale: 2,
    default: 0,
  })
  weightedAbsenceDays!: string;

  @Column({
    name: 'weighted_attendance_percent',
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
  })
  weightedAttendancePercent!: string | null;

  @Column({ name: 'risk_tier', type: 'varchar', length: 16 })
  riskTier!: string;

  @Column({ name: 'risk_severity', type: 'smallint' })
  riskSeverity!: number;

  @Column({ name: 'risk_score', type: 'numeric', precision: 10, scale: 4, default: 0 })
  riskScore!: string;

  @Column({ name: 'open_case_count', type: 'integer', default: 0 })
  openCaseCount!: number;

  @Column({ name: 'latest_open_case_id', type: 'integer', nullable: true })
  latestOpenCaseId!: number | null;

  @Column({ name: 'latest_open_task_id', type: 'text', nullable: true })
  latestOpenTaskId!: string | null;

  @Column({ name: 'profile_calculated_at', type: 'timestamptz' })
  profileCalculatedAt!: Date;

  @Column({ name: 'source_updated_at', type: 'timestamptz', nullable: true })
  sourceUpdatedAt!: Date | null;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt!: Date;
}
