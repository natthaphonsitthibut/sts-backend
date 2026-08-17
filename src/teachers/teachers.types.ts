export type TeacherStatus = 'ACTIVE' | 'INACTIVE';

/**
 * One teacher as shown on จัดการข้อมูลคุณครู — the person record joined to the
 * membership that puts them in the school currently being managed.
 */
export interface TeacherRow extends Record<string, unknown> {
  id: string;
  first_name: string;
  last_name: string;
  citizen_id: string | null;
  phone: string | null;
  email: string | null;
  line_id: string | null;
  photo_storage_key: string | null;
  teacher_status: TeacherStatus;
  membership_id: string;
  school_id: number;
  membership_status: TeacherStatus;
  started_on: string;
  ended_on: string | null;
  updated_at: string;
}
