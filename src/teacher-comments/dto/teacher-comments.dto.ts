/** One teacher comment on a student, as the student profile shows it. */
export class StudentClassroomCommentResponseDto {
  id!: string;
  studentTermId!: string;
  problemCategory!: string;
  problemCategoryLabel!: string;
  problemCategoryGuidance!: string | null;
  problemDescription!: string;
  concernLevelCode!: 'NOTE' | 'WATCH' | 'CONCERN';
  concernLevelLabel!: string;
  authorDisplayName!: string;
  commentedAt!: string;
}

/** One row of หน้าความคิดเห็นจากคุณครู, which also names the student's classroom. */
export class ClassroomCommentReportResponseDto {
  id!: string;
  studentUuid!: string;
  studentName!: string;
  schoolName!: string | null;
  gradeLabel!: string | null;
  roomNo!: string | null;
  problemCategory!: string;
  problemCategoryLabel!: string;
  problemCategoryGuidance!: string | null;
  problemDescription!: string;
  concernLevelCode!: 'NOTE' | 'WATCH' | 'CONCERN';
  concernLevelLabel!: string;
  authorDisplayName!: string;
  commentedAt!: string;
}
