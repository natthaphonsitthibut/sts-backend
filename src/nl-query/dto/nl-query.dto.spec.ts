import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { NlQueryDto } from './nl-query.dto';

describe('NlQueryDto', () => {
  it('accepts a Thai question and supported chart type', async () => {
    const dto = plainToInstance(NlQueryDto, {
      question: 'จำนวนนักเรียนแยกตามโรงเรียน',
      preferredChartType: 'bar',
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it.each([
    { question: '' },
    { question: 'ก'.repeat(501) },
    { question: 'นักเรียนทั้งหมด', preferredChartType: 'area' },
  ])('rejects invalid input %#', async (input) => {
    const errors = await validate(plainToInstance(NlQueryDto, input));
    expect(errors.length).toBeGreaterThan(0);
  });
});
