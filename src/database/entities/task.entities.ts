import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'cases' })
export class CaseEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'student_name', type: 'text' })
  studentName!: string;

  @Column({ name: 'student_school', type: 'text', nullable: true })
  studentSchool!: string | null;

  @Column({ name: 'school_id', type: 'integer', nullable: true })
  schoolId!: number | null;

  @Column({ name: 'student_address', type: 'text', nullable: true })
  studentAddress!: string | null;

  @Column({ name: 'student_lat', type: 'double precision', nullable: true })
  studentLat!: number | null;

  @Column({ name: 'student_lng', type: 'double precision', nullable: true })
  studentLng!: number | null;

  @Column({ name: 'reason_flagged', type: 'text', nullable: true })
  reasonFlagged!: string | null;

  @Column({ name: 'status', type: 'text', default: 'OPEN' })
  status!: string;

  @Column({ name: 'result_summary', type: 'text', nullable: true })
  resultSummary!: string | null;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true })
  createdAt!: Date | null;
}

@Entity({ name: 'tasks' })
export class TaskEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ name: 'case_id', type: 'integer', nullable: true })
  caseId!: number | null;

  @Column({ name: 'status', type: 'text', default: 'IN_PROGRESS' })
  status!: string;

  @Column({ name: 'created_at', type: 'timestamp', nullable: true })
  createdAt!: Date | null;

  @Column({ name: 'task_type', type: 'text', default: 'VISIT' })
  taskType!: string;

  @Column({ name: 'target_grade', type: 'text', nullable: true })
  targetGrade!: string | null;

  @Column({ name: 'target_room', type: 'text', nullable: true })
  targetRoom!: string | null;

  @Column({ name: 'target_school_id', type: 'integer', nullable: true })
  targetSchoolId!: number | null;
}

@Entity({ name: 'task_links' })
export class TaskLinkEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ name: 'task_id', type: 'uuid' })
  taskId!: string;

  @Column({ name: 'token_hash', type: 'text', unique: true })
  tokenHash!: string;

  @Column({ name: 'magic_link', type: 'text', nullable: true })
  magicLink!: string | null;

  @Column({ name: 'assigned_to_name', type: 'text', nullable: true })
  assignedToName!: string | null;

  @Column({ name: 'assigned_to_first_name', type: 'varchar', length: 150, nullable: true })
  assignedToFirstName!: string | null;

  @Column({ name: 'assigned_to_last_name', type: 'varchar', length: 150, nullable: true })
  assignedToLastName!: string | null;

  @Column({ name: 'assigned_to_phone', type: 'text', nullable: true })
  assignedToPhone!: string | null;

  @Column({ name: 'assigned_to_email', type: 'text', nullable: true })
  assignedToEmail!: string | null;

  @Column({ name: 'subject', type: 'text', nullable: true })
  subject!: string | null;

  @Column({ name: 'status', type: 'text', default: 'ACTIVE' })
  status!: string;

  @Column({ name: 'admin_locked', type: 'integer', default: 0 })
  adminLocked!: number;

  @Column({ name: 'admin_lock_reason', type: 'text', nullable: true })
  adminLockReason!: string | null;

  @Column({ name: 'admin_lock_at', type: 'timestamptz', nullable: true })
  adminLockAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'created_at', type: 'timestamptz', nullable: true })
  createdAt!: Date | null;

  @Column({ name: 'created_by', type: 'integer', nullable: true })
  createdBy!: number | null;

  @Column({ name: 'first_used_at', type: 'timestamptz', nullable: true })
  firstUsedAt!: Date | null;
}

@Entity({ name: 'task_submissions' })
export class TaskSubmissionEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'task_link_id', type: 'uuid', nullable: true })
  taskLinkId!: string | null;

  @Column({ name: 'visit_lat', type: 'real', nullable: true })
  visitLat!: number | null;

  @Column({ name: 'visit_lng', type: 'real', nullable: true })
  visitLng!: number | null;

  @Column({ name: 'visited_at', type: 'timestamptz', nullable: true })
  visitedAt!: Date | null;

  @Column({ name: 'follow_up_problem_category_code', type: 'varchar', length: 32, nullable: true })
  followUpProblemCategoryCode!: string | null;

  @Column({ name: 'absence_reason_code', type: 'varchar', length: 40, nullable: true })
  absenceReasonCode!: string | null;

  @Column({ name: 'parental_status_code', type: 'varchar', length: 40, nullable: true })
  parentalStatusCode!: string | null;

  @Column({ name: 'guardian_type_code', type: 'varchar', length: 40, nullable: true })
  guardianTypeCode!: string | null;

  @Column({ name: 'guardian_type_detail', type: 'varchar', length: 200, nullable: true })
  guardianTypeDetail!: string | null;

  @Column({ name: 'residence_environment_detail', type: 'text', nullable: true })
  residenceEnvironmentDetail!: string | null;

  @Column({ name: 'cause_detail', type: 'text', nullable: true })
  causeDetail!: string | null;

  @Column({ name: 'photo_paths', type: 'text', nullable: true })
  photoPaths!: string | null;

  @Column({ name: 'recommendation', type: 'text', nullable: true })
  recommendation!: string | null;

  @Column({ name: 'address_changed', type: 'boolean', default: false })
  addressChanged!: boolean;

  @Column({ name: 'home_visit_exception_code', type: 'varchar', length: 40, nullable: true })
  homeVisitExceptionCode!: string | null;

  @Column({ name: 'updated_student_address', type: 'text', nullable: true })
  updatedStudentAddress!: string | null;

  @Column({ name: 'updated_address_line', type: 'text', nullable: true })
  updatedAddressLine!: string | null;

  @Column({ name: 'updated_address_province', type: 'text', nullable: true })
  updatedAddressProvince!: string | null;

  @Column({ name: 'updated_address_district', type: 'text', nullable: true })
  updatedAddressDistrict!: string | null;

  @Column({ name: 'updated_address_sub_district', type: 'text', nullable: true })
  updatedAddressSubDistrict!: string | null;

  @Column({ name: 'updated_postal_code', type: 'varchar', length: 5, nullable: true })
  updatedPostalCode!: string | null;

  @Column({ name: 'updated_lat', type: 'real', nullable: true })
  updatedLat!: number | null;

  @Column({ name: 'updated_lng', type: 'real', nullable: true })
  updatedLng!: number | null;

  @Column({ name: 'submitted_at', type: 'timestamptz', nullable: true })
  submittedAt!: Date | null;
}

@Entity({ name: 'case_reviews' })
export class CaseReviewEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ name: 'case_id', type: 'integer' })
  caseId!: number;

  @Column({ name: 'review_action', type: 'text' })
  reviewAction!: string;

  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote!: string | null;

  @Column({ name: 'resolution_outcome', type: 'varchar', length: 40, nullable: true })
  resolutionOutcome!: string | null;

  @Column({ name: 'proposed_assistance_measure_detail', type: 'text', nullable: true })
  proposedAssistanceMeasureDetail!: string | null;

  @Column({ name: 'reviewed_by', type: 'text', nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamptz', nullable: true })
  reviewedAt!: Date | null;
}

@Entity({ name: 'case_risk_signals' })
export class CaseRiskSignalEntity {
  @PrimaryColumn({ name: 'id', type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ name: 'case_id', type: 'integer' })
  caseId!: number;

  @Column({ name: 'signal_source_code', type: 'varchar', length: 40 })
  signalSourceCode!: string;

  @Column({ name: 'signal_rule_code', type: 'varchar', length: 40, nullable: true })
  signalRuleCode!: string | null;

  @Column({ name: 'signal_reason', type: 'varchar', length: 1000 })
  signalReason!: string;

  @Column({ name: 'detected_at', type: 'timestamptz' })
  detectedAt!: Date;
}
