// Single source of truth for attendance record statuses. The numeric codes are
// the persisted `attendance."AttendanceStatus"` values and are constrained by a
// FK to `attendance_record_statuses`, so adding a status here also requires a
// migration seeding that catalog row (see AddLeaveAttendanceStatus).
// Thai labels/colors are NOT defined here — those come from the catalog table so
// the UI stays configurable without a deploy.

export type AttendanceSelectionStatus = 'P_PRESENT' | 'P_ABSENT' | 'P_LATE' | 'P_LEAVE';

/** A selection plus the "not recorded" case used when reading history. */
export type AttendanceHistoryStatus = AttendanceSelectionStatus | 'NONE';

export const ATTENDANCE_SELECTION_STATUS_VALUES = [
  'P_PRESENT',
  'P_ABSENT',
  'P_LATE',
  'P_LEAVE',
] as const satisfies readonly AttendanceSelectionStatus[];

export const ATTENDANCE_STATUS_CODE: Record<AttendanceSelectionStatus, number> = {
  P_PRESENT: 1,
  P_ABSENT: 2,
  P_LATE: 3,
  P_LEAVE: 4,
};

const STATUS_BY_CODE = new Map<number, AttendanceSelectionStatus>(
  ATTENDANCE_SELECTION_STATUS_VALUES.map((status) => [ATTENDANCE_STATUS_CODE[status], status]),
);

/** Maps a persisted code (or its string form) back to a status, `NONE` when unknown. */
export function attendanceStatusFromCode(code: unknown): AttendanceHistoryStatus {
  const parsed =
    typeof code === 'number'
      ? code
      : typeof code === 'string'
        ? Number.parseInt(code, 10)
        : Number.NaN;
  return STATUS_BY_CODE.get(parsed) ?? 'NONE';
}
