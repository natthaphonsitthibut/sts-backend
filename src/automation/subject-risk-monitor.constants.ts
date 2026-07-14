export const SUBJECT_RISK_SETTING_KEYS = {
  mixedAbsenceWindowDays: 'SUBJECT_RISK_MIXED_ABSENCE_WINDOW_DAYS',
  mixedAbsenceDays: 'SUBJECT_RISK_MIXED_ABSENCE_DAYS',
  avoidanceWindowDays: 'SUBJECT_RISK_AVOIDANCE_WINDOW_DAYS',
  avoidanceConsecutivePeriods: 'SUBJECT_RISK_AVOIDANCE_CONSECUTIVE_PERIODS',
  avoidanceAbsentPercent: 'SUBJECT_RISK_AVOIDANCE_ABSENT_PERCENT',
  lateWindowDays: 'SUBJECT_RISK_LATE_WINDOW_DAYS',
  lateWatchCount: 'SUBJECT_RISK_LATE_WATCH_COUNT',
  termAbsenceDays: 'CASE_RISK_TERM_ABSENCE_DAYS',
  highAttendancePercent: 'CASE_RISK_HIGH_ATTENDANCE_PERCENT',
  slaHighDays: 'CASE_SLA_HIGH_DAYS',
  slaMediumDays: 'CASE_SLA_MEDIUM_DAYS',
} as const;

export const SUBJECT_RISK_DEFAULTS = {
  mixedAbsenceWindowDays: 7,
  mixedAbsenceDays: 3,
  avoidanceWindowDays: 30,
  avoidanceConsecutivePeriods: 3,
  avoidanceAbsentPercent: 30,
  lateWindowDays: 30,
  lateWatchCount: 5,
  termAbsenceDays: 7,
  highAttendancePercent: 80,
  slaHighDays: 3,
  slaMediumDays: 7,
} as const;

export const STUDENT_RISK_WATCH_NOTIFICATION_TYPE = 'STUDENT_RISK_WATCH';
export const STUDENT_RISK_WATCH_REF_ENTITY = 'student-risk-watch';

export const ATTENDANCE_RISK_CASE_REASON_PREFIXES = [
  'ขาดเรียนติดต่อกัน%',
  'โดดคาบ%',
  'เลี่ยงวิชา%',
  'ขาดสะสมต่อเทอม%',
  'เวลาเรียนต่ำกว่า%',
] as const;

export const ACTIVE_CASE_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'REPORTED_UP',
  'PENDING_REVIEW',
] as const;
