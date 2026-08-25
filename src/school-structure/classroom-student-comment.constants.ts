export const CLASSROOM_STUDENT_PROBLEM_CATEGORIES = [
  'HEALTH',
  'SOCIAL_INTEGRATION',
  'ACADEMIC',
  'EMOTIONAL',
  'FINANCIAL',
  'ATTENDANCE',
  'FAMILY_CARE',
  'SAFETY',
  'OTHER',
] as const;

export type ClassroomStudentProblemCategory = (typeof CLASSROOM_STUDENT_PROBLEM_CATEGORIES)[number];

export interface ClassroomStudentProblemCategoryOption {
  code: ClassroomStudentProblemCategory;
  label: string;
  guidance: string | null;
}

export const CLASSROOM_STUDENT_COMMENT_CONCERN_LEVELS = ['NOTE', 'WATCH', 'CONCERN'] as const;

export type ClassroomStudentCommentConcernLevel =
  (typeof CLASSROOM_STUDENT_COMMENT_CONCERN_LEVELS)[number];

export interface ClassroomStudentCommentConcernLevelOption {
  code: ClassroomStudentCommentConcernLevel;
  label: string;
}
