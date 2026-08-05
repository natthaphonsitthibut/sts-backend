export const STUDENT_RISK_WATCH_NOTIFICATION_TYPE = 'STUDENT_RISK_WATCH';
export const STUDENT_RISK_WATCH_REF_ENTITY = 'student-risk-watch';

/**
 * Reasons written by the automated absence monitor. The retired subject-risk
 * rules (โดดคาบ / เลี่ยงวิชา / ขาดสะสมต่อเทอม / เวลาเรียนต่ำกว่าเกณฑ์) stay listed
 * so cases they opened before the rule change are still recognised as
 * attendance-driven ones.
 */
export const ABSENCE_CASE_REASON_PREFIXES = ['ขาดเรียนสะสม%', 'ขาดเรียนติดต่อกัน%'] as const;

export const ACTIVE_CASE_STATUSES = ['OPEN', 'IN_PROGRESS', 'PENDING_REVIEW'] as const;
