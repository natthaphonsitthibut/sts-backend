export const TEACHER_ACCESS_CAPABILITIES = ['HOMEROOM_ATTENDANCE', 'TEACHER_OBSERVATION'] as const;

export type TeacherAccessCapability = (typeof TEACHER_ACCESS_CAPABILITIES)[number];

export const TEACHER_ACCESS_STEP_UP_POLICIES = ['NONE', 'EMAIL_OTP', 'THAID'] as const;
export type TeacherAccessStepUpPolicy = (typeof TEACHER_ACCESS_STEP_UP_POLICIES)[number];

export const TEACHER_ACCESS_SETTING_KEYS = {
  expiryPolicy: 'TEACHER_ACCESS_DEFAULT_EXPIRY_POLICY',
  stepUpPolicy: 'TEACHER_ACCESS_DEFAULT_STEP_UP_POLICY',
} as const;

export const TEACHER_ACCESS_EXPIRY_POLICIES = ['TERM_END', 'ASSIGNMENT_END'] as const;
export type TeacherAccessExpiryPolicy = (typeof TEACHER_ACCESS_EXPIRY_POLICIES)[number];

export const TEACHER_ACCESS_TOKEN_HEADER = 'x-teacher-access-token';
export const TEACHER_ACCESS_LINK_PATH = '/teacher-access';
