export type CurriculumStatus = 'ACTIVE' | 'INACTIVE';

/** Grade level card on จัดการข้อมูลหลักสูตร, with how many subjects it offers. */
export interface CurriculumGradeRow extends Record<string, unknown> {
  grade_level_id: number;
  grade_label: string;
  grade_category: string | null;
  subject_count: number;
}

/** One subject offered by a school for a grade level in a term. */
export interface CurriculumSubjectRow extends Record<string, unknown> {
  id: string;
  school_id: number;
  school_term_id: string;
  grade_level_id: number;
  grade_label: string;
  subject_id: number;
  subject_code: string;
  subject_name: string;
  content_storage_key: string | null;
  content_file_name: string | null;
  content_file_size_bytes: number | null;
  curriculum_status: CurriculumStatus;
  updated_at: string;
}

/** One teacher covering one classroom for a subject offering. */
export interface CurriculumSubjectTeacherRow extends Record<string, unknown> {
  id: string;
  curriculum_subject_id: string;
  teacher_membership_id: string;
  teacher_name: string;
  classroom_id: string;
  classroom_label: string;
}
