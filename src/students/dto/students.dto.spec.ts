import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GetStudentSubjectAttendanceQueryDto } from './students.dto';

describe('student query DTOs', () => {
  it('accepts only a valid calendar date for subject attendance', () => {
    const validateDate = (date: string) =>
      validateSync(plainToInstance(GetStudentSubjectAttendanceQueryDto, { date }));

    expect(validateDate('2026-08-02')).toHaveLength(0);
    expect(validateDate('2026-08-02T00:00:00Z')).not.toHaveLength(0);
    expect(validateDate('2026-08-02T23:30:00-12:00')).not.toHaveLength(0);
    expect(validateDate('2026-02-30')).not.toHaveLength(0);
  });
});
