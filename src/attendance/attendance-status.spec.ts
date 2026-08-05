import { ATTENDANCE_STATUS_CODE, attendanceStatusFromCode } from './attendance-status';

describe('attendance status mapping', () => {
  it('maps leave consistently between its API value and persisted code', () => {
    expect(ATTENDANCE_STATUS_CODE.P_LEAVE).toBe(4);
    expect(attendanceStatusFromCode(4)).toBe('P_LEAVE');
    expect(attendanceStatusFromCode('4')).toBe('P_LEAVE');
  });

  it('maps unknown persisted values to NONE', () => {
    expect(attendanceStatusFromCode(99)).toBe('NONE');
    expect(attendanceStatusFromCode(null)).toBe('NONE');
  });
});
