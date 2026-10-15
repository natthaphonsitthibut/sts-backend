import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SubmitReferralReportDto } from './task.dto';

describe('SubmitReferralReportDto', () => {
  const validateActionAt = (action_at: string) =>
    validate(
      plainToInstance(SubmitReferralReportDto, {
        result_code: 'SUCCEEDED',
        result_note: 'นักเรียนกลับมาเรียนแล้ว',
        action_at,
      }),
    );
  it.each(['2026-02-31T10:00:00+07:00', '2026-13-01T10:00:00+07:00', 'yesterday', ''])(
    'refuses an invalid action time %s',
    async (value) => {
      expect(await validateActionAt(value)).toEqual(
        expect.arrayContaining([expect.objectContaining({ property: 'action_at' })]),
      );
    },
  );
  it.each(['2026-10-08T14:30:00+07:00', '2026-10-08T07:30:00.000Z'])(
    'accepts a valid action time %s',
    async (value) => {
      expect(await validateActionAt(value)).toEqual([]);
    },
  );
});
