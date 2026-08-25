export interface ClassroomCommentListRow extends Record<string, unknown> {
  id: string;
  student_uuid: string;
  student_name: string;
  school_name: string | null;
  grade_label: string | null;
  room_no: string | null;
  problem_category_code: string;
  problem_category_label: string;
  problem_category_guidance: string | null;
  problem_description: string;
  concern_level_code: 'NOTE' | 'WATCH' | 'CONCERN';
  concern_level_label: string;
  author_display_name: string;
  commented_at: Date | string;
  total_count?: number | string;
}

export interface StudentClassroomCommentRow extends Record<string, unknown> {
  id: string;
  student_uuid: string;
  problem_category_code: string;
  problem_category_label: string;
  problem_category_guidance: string | null;
  problem_description: string;
  concern_level_code: 'NOTE' | 'WATCH' | 'CONCERN';
  concern_level_label: string;
  author_display_name: string;
  commented_at: Date | string;
  total_count?: number | string;
}
