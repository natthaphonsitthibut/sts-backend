export const TEACHER_ACCESS_CAPABILITIES = ['SUBJECT_ATTENDANCE', 'TEACHER_OBSERVATION'] as const;

export type TeacherAccessCapability = (typeof TEACHER_ACCESS_CAPABILITIES)[number];

/**
 * A link is scoped to the rooms and subjects a teacher actually teaches, so a
 * teacher with no assignment has nothing to open. Naming the next step matters:
 * a freshly created teacher hits this first, and "ยังไม่มีห้อง" alone leaves
 * them with no idea which screen fixes it.
 */
export const TEACHER_ACCESS_NO_ASSIGNMENT_REASON =
  'ยังไม่มีห้องหรือรายวิชาในภาคเรียนนี้ — กำหนดครูประจำชั้นที่หน้าโครงสร้างโรงเรียน หรือเพิ่มครูผู้สอนในรายวิชาที่หน้าหลักสูตรก่อน';

export const TEACHER_ACCESS_STEP_UP_POLICIES = ['NONE', 'EMAIL_OTP', 'ARAID'] as const;
export type TeacherAccessStepUpPolicy = (typeof TEACHER_ACCESS_STEP_UP_POLICIES)[number];

export const TEACHER_ACCESS_EXPIRY_POLICIES = ['TERM_END', 'ASSIGNMENT_END'] as const;
export type TeacherAccessExpiryPolicy = (typeof TEACHER_ACCESS_EXPIRY_POLICIES)[number];

/**
 * A link is issued once per term and dies with it, and every link verifies by
 * email OTP — there is nothing per-deployment to tune, so these are constants
 * rather than system settings an admin has to understand and maintain.
 */
export const TEACHER_ACCESS_DEFAULT_EXPIRY_POLICY: TeacherAccessExpiryPolicy = 'TERM_END';
export const TEACHER_ACCESS_DEFAULT_STEP_UP_POLICY: TeacherAccessStepUpPolicy = 'EMAIL_OTP';

export const TEACHER_ACCESS_TOKEN_HEADER = 'x-teacher-access-token';
export const TEACHER_ACCESS_SESSION_HEADER = 'x-teacher-access-session';
export const TEACHER_ACCESS_ARAID_CHALLENGE_HEADER = 'x-teacher-access-araid-challenge';
export const TEACHER_ACCESS_LINK_PATH = '/teacher-access';
