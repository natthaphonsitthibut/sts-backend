export interface TimetableSlotRow extends Record<string, unknown> {
  id: string;
  school_term_id: string;
  school_id: number;
  grade_level_id: number;
  room_no: number;
  day_of_week: number;
  period: number;
  subject_id: number;
  subject_code: string;
  subject_name_th: string;
  teacher_user_id: number | null;
  teacher_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface RoomSubjectRow extends Record<string, unknown> {
  subject_id: number;
  code: string;
  name_th: string;
}

export interface TimetableTeacherCandidateRow extends Record<string, unknown> {
  id: number;
  display_name: string;
}
