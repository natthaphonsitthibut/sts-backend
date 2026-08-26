import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AttendanceReconciliationQueryDto, UpsertSchoolTermDto } from './attendance-operations.dto';

const TERM_BASE = {
  schoolId: 1001,
  academicYear: 2569,
  semester: 1,
  status: 'ACTIVE',
};

describe('attendance operations DTOs', () => {
  it('accepts real calendar dates for a school term', () => {
    expect(
      validateSync(
        plainToInstance(UpsertSchoolTermDto, {
          ...TERM_BASE,
          startsOn: '2026-05-16',
          endsOn: '2024-02-29',
        }),
      ),
    ).toHaveLength(0);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-05-16T00:00:00Z'])(
    'rejects the term date %s before it reaches the date column',
    (value) => {
      expect(
        validateSync(
          plainToInstance(UpsertSchoolTermDto, {
            ...TERM_BASE,
            startsOn: value,
            endsOn: '2026-10-10',
          }),
        ),
      ).toHaveLength(1);
      expect(
        validateSync(
          plainToInstance(UpsertSchoolTermDto, {
            ...TERM_BASE,
            startsOn: '2026-05-16',
            endsOn: value,
          }),
        ),
      ).toHaveLength(1);
    },
  );

  it('accepts a real reconciliation date and rejects one that does not exist', () => {
    const build = (date: string) =>
      plainToInstance(AttendanceReconciliationQueryDto, { termId: 21, date });

    expect(validateSync(build('2026-08-26'))).toHaveLength(0);
    expect(validateSync(build('2026-02-30'))).toHaveLength(1);
    expect(validateSync(build('26/08/2026'))).toHaveLength(1);
  });
});
