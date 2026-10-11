import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListConversationsQueryDto, NlQueryDto, RenameConversationDto } from './nl-query.dto';

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

describe('NlQueryDto conversationId', () => {
  it('accepts a uuid conversationId', async () => {
    const dto = plainToInstance(NlQueryDto, {
      question: 'ต่อ',
      conversationId: '3f0c7a52-6a0e-4a3b-9d55-0f6f1b7a9c11',
    });
    await expect(validate(dto)).resolves.toEqual([]);
  });

  it('rejects a non-uuid conversationId', async () => {
    const errors = await validate(
      plainToInstance(NlQueryDto, { question: 'ต่อ', conversationId: 'abc' }),
    );
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('RenameConversationDto', () => {
  it('trims the title', async () => {
    const dto = plainToInstance(RenameConversationDto, { title: '  ชื่อใหม่  ' });
    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.title).toBe('ชื่อใหม่');
  });

  it.each([{ title: '' }, { title: '   ' }, { title: 'ก'.repeat(121) }, {}])(
    'rejects invalid title %#',
    async (input) => {
      const errors = await validate(plainToInstance(RenameConversationDto, input));
      expect(errors.length).toBeGreaterThan(0);
    },
  );
});

describe('ListConversationsQueryDto', () => {
  it('accepts no params and coerces limit from a query string', async () => {
    await expect(validate(plainToInstance(ListConversationsQueryDto, {}))).resolves.toEqual([]);
    const dto = plainToInstance(ListConversationsQueryDto, {
      limit: '20',
      before: '2026-10-02T00:00:00.000Z',
    });
    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.limit).toBe(20);
  });

  it.each([{ limit: '0' }, { limit: '51' }, { before: 'yesterday' }])(
    'rejects invalid query %#',
    async (input) => {
      const errors = await validate(plainToInstance(ListConversationsQueryDto, input));
      expect(errors.length).toBeGreaterThan(0);
    },
  );
});
