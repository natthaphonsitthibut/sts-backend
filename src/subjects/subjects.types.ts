export interface SchoolSubjectRow extends Record<string, unknown> {
  id: string;
  school_id: number;
  subject_id: number;
  code: string;
  name_th: string;
  subject_status: 'ACTIVE' | 'INACTIVE';
  classroom_count: number;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface ClassroomSubjectRow extends Record<string, unknown> {
  id: string;
  school_id: number;
  classroom_id: string;
  school_subject_id: string;
  subject_id: number;
  code: string;
  name_th: string;
  offering_status: 'ACTIVE' | 'INACTIVE';
}

export interface SubjectGradeRow extends Record<string, unknown> {
  grade_level_id: number;
  grade_label: string;
  grade_category: string | null;
  subject_count: number;
}

export interface GradeSchoolSubjectRow extends SchoolSubjectRow {
  grade_level_id: number;
  grade_label: string;
}

export interface SubjectTeacherAssignment {
  membershipId: string;
  teacherId: string;
  name: string;
  /** Null when no photo is set; stamps the version the photo url carries. */
  photoUpdatedAt: string | null;
}

export interface GradeSubjectClassroomRow extends Record<string, unknown> {
  school_subject_id: string;
  classroom_subject_id: string;
  classroom_id: string;
  classroom_label: string;
  teachers: SubjectTeacherAssignment[];
}
