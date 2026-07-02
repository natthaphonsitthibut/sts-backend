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
