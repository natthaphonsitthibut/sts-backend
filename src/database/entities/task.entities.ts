import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'cases' })
export class CaseEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'student_name', type: 'text' })
  studentName!: string;

  @Column({ name: 'student_school', type: 'text', nullable: true })
  studentSchool!: string | null;

  @Column({ name: 'student_address', type: 'text', nullable: true })
  studentAddress!: string | null;

  @Column({ name: 'student_lat', type: 'real', nullable: true })
  studentLat!: number | null;

  @Column({ name: 'student_lng', type: 'real', nullable: true })
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
  @PrimaryColumn({ name: 'id', type: 'text' })
  id!: string;

  @Column({ name: 'case_id', type: 'integer', nullable: true })
  caseId!: number | null;

  @Column({ name: 'status', type: 'text', default: 'PENDING' })
  status!: string;

  @Column({ name: 'max_delegation_depth', type: 'integer', default: 3 })
  maxDelegationDepth!: number;

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
  @PrimaryColumn({ name: 'id', type: 'text' })
  id!: string;

  @Column({ name: 'task_id', type: 'text' })
  taskId!: string;

  @Column({ name: 'parent_link_id', type: 'text', nullable: true })
  parentLinkId!: string | null;

  @Column({ name: 'token_hash', type: 'text', unique: true })
  tokenHash!: string;

  @Column({ name: 'magic_link', type: 'text', nullable: true })
  magicLink!: string | null;

  @Column({ name: 'delegation_depth', type: 'integer', default: 0 })
  delegationDepth!: number;

  @Column({ name: 'assigned_to_name', type: 'text', nullable: true })
  assignedToName!: string | null;

  @Column({ name: 'assigned_to_phone', type: 'text', nullable: true })
  assignedToPhone!: string | null;

  @Column({ name: 'assigned_to_email', type: 'text', nullable: true })
  assignedToEmail!: string | null;

  @Column({ name: 'otp_code', type: 'text', nullable: true })
  otpCode!: string | null;

  @Column({
    name: 'otp_expires_at',
    type: 'timestamptz',
    nullable: true,
  })
  otpExpiresAt!: Date | null;

  @Column({ name: 'otp_verified', type: 'integer', default: 0 })
  otpVerified!: number;

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

  @Column({ name: 'created_by_user_id', type: 'integer', nullable: true })
  createdByUserId!: number | null;

  @Column({ name: 'login_role', type: 'text', nullable: true })
  loginRole!: string | null;

  @Column({
    name: 'login_permissions',
    type: 'jsonb',
    default: () => "'[]'::jsonb",
  })
  loginPermissions!: string[];

  @Column({
    name: 'login_data_scope',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  loginDataScope!: Record<string, unknown>;
}

@Entity({ name: 'task_submissions' })
export class TaskSubmissionEntity {
  @PrimaryGeneratedColumn({ name: 'id' })
  id!: number;

  @Column({ name: 'task_link_id', type: 'text', nullable: true })
  taskLinkId!: string | null;

  @Column({ name: 'visit_lat', type: 'real', nullable: true })
  visitLat!: number | null;

  @Column({ name: 'visit_lng', type: 'real', nullable: true })
  visitLng!: number | null;

  @Column({ name: 'cause_category', type: 'text', nullable: true })
  causeCategory!: string | null;

  @Column({ name: 'cause_detail', type: 'text', nullable: true })
  causeDetail!: string | null;

  @Column({ name: 'photo_paths', type: 'text', nullable: true })
  photoPaths!: string | null;

  @Column({ name: 'recommendation', type: 'text', nullable: true })
  recommendation!: string | null;

  @Column({ name: 'address_changed', type: 'boolean', default: false })
  addressChanged!: boolean;

  @Column({ name: 'updated_student_address', type: 'text', nullable: true })
  updatedStudentAddress!: string | null;

  @Column({ name: 'updated_lat', type: 'real', nullable: true })
  updatedLat!: number | null;

  @Column({ name: 'updated_lng', type: 'real', nullable: true })
  updatedLng!: number | null;

  @Column({ name: 'submitted_at', type: 'timestamp', nullable: true })
  submittedAt!: Date | null;
}

@Entity({ name: 'case_reviews' })
export class CaseReviewEntity {
  @PrimaryColumn({ name: 'id', type: 'text' })
  id!: string;

  @Column({ name: 'case_id', type: 'integer' })
  caseId!: number;

  @Column({ name: 'review_action', type: 'text' })
  reviewAction!: string;

  @Column({ name: 'review_note', type: 'text', nullable: true })
  reviewNote!: string | null;

  @Column({ name: 'reviewed_by', type: 'text', nullable: true })
  reviewedBy!: string | null;

  @Column({ name: 'reviewed_at', type: 'timestamp', nullable: true })
  reviewedAt!: Date | null;
}
