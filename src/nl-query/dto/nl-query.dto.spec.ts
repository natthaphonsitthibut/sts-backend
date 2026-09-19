import 'reflect-metadata';
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

  it('accepts an empty history array (agent mode, turn 1)', async () => {
    const dto = plainToInstance(NlQueryDto, {
      question: 'เด็กเสี่ยงมีเท่าไหร่',
      history: [],
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('accepts a valid multi-turn history (clarification then result)', async () => {
    const dto = plainToInstance(NlQueryDto, {
      question: 'แล้วเฉพาะเสี่ยงสูงล่ะ',
      history: [
        {
          question: 'เด็กเสี่ยงมีเท่าไหร่',
          answerType: 'clarification',
          sql: null,
          rowCount: 0,
        },
        {
          question: 'เสี่ยงสูงภาคเรียนนี้ครับ',
          answerType: 'result',
          sql: 'SELECT COUNT(*) FROM students',
          rowCount: 12,
        },
      ],
    });

    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects a result turn missing sql', async () => {
    const dto = plainToInstance(NlQueryDto, {
      question: 'ต่อ',
      history: [{ question: 'ก่อนหน้า', answerType: 'result', rowCount: 5 }],
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it.each(['clarification', 'refusal'] as const)(
    'rejects a %s turn that includes sql',
    async (answerType) => {
      const dto = plainToInstance(NlQueryDto, {
        question: 'ต่อ',
        history: [
          {
            question: 'ก่อนหน้า',
            answerType,
            sql: 'SELECT 1',
            rowCount: 0,
          },
        ],
      });

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
    },
  );

  it('rejects a history array longer than 50 turns', async () => {
    const dto = plainToInstance(NlQueryDto, {
      question: 'ต่อ',
      history: Array.from({ length: 51 }, (_, i) => ({
        question: `คำถามที่ ${i}`,
        answerType: 'result',
        sql: 'SELECT 1',
        rowCount: 0,
      })),
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an invalid answerType in history', async () => {
    const dto = plainToInstance(NlQueryDto, {
      question: 'ต่อ',
      history: [{ question: 'ก่อนหน้า', answerType: 'bogus', sql: null, rowCount: 0 }],
    });

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});
