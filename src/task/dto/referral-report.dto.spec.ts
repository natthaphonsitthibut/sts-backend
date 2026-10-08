import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SubmitReferralReportDto } from './task.dto';

describe('SubmitReferralReportDto', () => {
  const validateDate = (action_date: string) =>
    validate(
      plainToInstance(SubmitReferralReportDto, {
        result_code: 'SUCCEEDED',
        result_note: 'นักเรียนกลับมาเรียนแล้ว',
        action_date,
      }),
    );
  it.each(['2026-02-31', '2026-13-01', '2026-00-10', '2026-10-08T00:00:00Z'])(
    'refuses invalid or non-date-only action date %s',
    async (date) => {
      expect(await validateDate(date)).toEqual(
        expect.arrayContaining([expect.objectContaining({ property: 'action_date' })]),
      );
    },
  );
  it.each(['2026-10-08', '2024-02-29'])('accepts valid date %s', async (date) => {
    expect(await validateDate(date)).toEqual([]);
  });
});
