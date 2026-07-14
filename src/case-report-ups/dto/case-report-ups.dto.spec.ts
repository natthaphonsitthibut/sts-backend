import 'reflect-metadata';
import { validate } from 'class-validator';
import { CreateCaseReportUpDto } from './case-report-ups.dto';

describe('CreateCaseReportUpDto', () => {
  it('accepts a bounded reason and summary', async () => {
    const dto = Object.assign(new CreateCaseReportUpDto(), {
      reason: 'โรงเรียนดำเนินการภายในครบแล้ว',
      summary: 'ต้องการการประสานสนับสนุนระดับจังหวัด',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    { reason: '', summary: 'มีสรุป' },
    { reason: 'มีเหตุผล', summary: '' },
    { reason: '   ', summary: 'มีสรุป' },
    { reason: 'มีเหตุผล', summary: '   ' },
    { reason: 'x'.repeat(501), summary: 'มีสรุป' },
    { reason: 'มีเหตุผล', summary: 'x'.repeat(2001) },
  ])('rejects invalid payload %#', async (input) => {
    const dto = Object.assign(new CreateCaseReportUpDto(), input);
    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });
});
