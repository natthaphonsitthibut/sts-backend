export const CLASSROOM_STUDENT_PROBLEM_CATEGORIES = [
  'HEALTH',
  'SOCIAL_INTEGRATION',
  'ACADEMIC',
  'EMOTIONAL',
  'FINANCIAL',
  'OTHER',
] as const;

export type ClassroomStudentProblemCategory = (typeof CLASSROOM_STUDENT_PROBLEM_CATEGORIES)[number];

export interface ClassroomStudentProblemCategoryOption {
  code: ClassroomStudentProblemCategory;
  label: string;
  guidance: string | null;
}
