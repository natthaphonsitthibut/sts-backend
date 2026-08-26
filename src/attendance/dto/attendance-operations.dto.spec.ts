import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpsertSchoolTermDto } from './attendance-operations.dto';

const TERM_BASE = {
  schoolId: 1001,
  academicYear: 2569,
  semester: 1,
  status: 'ACTIVE',
};

describe('school term DTOs', () => {
  it('accepts real dates for a school term', () => {
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

  it('carries an optional term id so an edit can rewrite its own row', () => {
    const created = plainToInstance(UpsertSchoolTermDto, {
      ...TERM_BASE,
      startsOn: '2026-05-16',
      endsOn: '2026-10-10',
    });
    expect(validateSync(created)).toHaveLength(0);
    expect(created.termId).toBeUndefined();

    const edited = plainToInstance(UpsertSchoolTermDto, {
      ...TERM_BASE,
      termId: '10',
      startsOn: '2026-05-16',
      endsOn: '2026-10-10',
    });
    expect(validateSync(edited)).toHaveLength(0);
    expect(edited.termId).toBe(10);

    expect(
      validateSync(
        plainToInstance(UpsertSchoolTermDto, {
          ...TERM_BASE,
          termId: 'not-a-term',
          startsOn: '2026-05-16',
          endsOn: '2026-10-10',
        }),
      ),
    ).toHaveLength(1);
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
});
