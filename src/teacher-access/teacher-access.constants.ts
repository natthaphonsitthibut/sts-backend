export const TEACHER_ACCESS_CAPABILITIES = [
  'HOMEROOM_ATTENDANCE',
  'SUBJECT_ATTENDANCE',
  'TEACHER_OBSERVATION',
] as const;

export type TeacherAccessCapability = (typeof TEACHER_ACCESS_CAPABILITIES)[number];

/** Capability a teacher needs to record attendance for each kind of assignment. */
export const TEACHER_ACCESS_ATTENDANCE_CAPABILITY = {
  HOMEROOM: 'HOMEROOM_ATTENDANCE',
  SUBJECT: 'SUBJECT_ATTENDANCE',
} as const satisfies Record<'HOMEROOM' | 'SUBJECT', TeacherAccessCapability>;

export const TEACHER_ACCESS_STEP_UP_POLICIES = ['NONE', 'EMAIL_OTP', 'THAID'] as const;
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
export const TEACHER_ACCESS_LINK_PATH = '/teacher-access';
