import { NotFoundException } from '@nestjs/common';
import type { DataSource, Repository } from 'typeorm';
import type { QueryEnvelope } from './dto/nl-query.dto';
import { NlConversationService } from './nl-conversation.service';
import { NlConversation } from './entities/nl-conversation.entity';
import { NlConversationTurn } from './entities/nl-conversation-turn.entity';

function envelope(overrides: Partial<QueryEnvelope> = {}): QueryEnvelope {
  return {
    status: 'ok',
    request_id: 'r1',
    question: 'q',
    answer_type: 'result',
    message: null,
    sql: 'SELECT 1',
    columns: [],
    rows: [{ total: 1 }],
    row_count: 1,
    truncated: false,
    summary: null,
    visualization: null,
    retry_count: 0,
    elapsed_ms: 5,
    error: null,
    ...overrides,
  };
}

function turnRow(seq: number, env: QueryEnvelope, question = `q${seq}`) {
  return { seq, question, answerType: env.answer_type ?? 'result', envelope: env };
}

describe('NlConversationService', () => {
  let conversations: jest.Mocked<Pick<Repository<NlConversation>, 'findOne' | 'find' | 'update'>>;
  let turns: jest.Mocked<Pick<Repository<NlConversationTurn>, 'find'>>;
  let manager: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    maximum: jest.Mock;
    update: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let service: NlConversationService;

  beforeEach(() => {
    conversations = { findOne: jest.fn(), find: jest.fn(), update: jest.fn() };
    turns = { find: jest.fn() };
    manager = {
      findOne: jest.fn(),
      create: jest.fn((_entity: unknown, value: object) => value),
      save: jest.fn((_entity: unknown, value: object) =>
        Promise.resolve({ id: 'c-new', ...value }),
      ),
      maximum: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSource = {
      transaction: jest.fn((cb: (m: typeof manager) => Promise<unknown>) => cb(manager)),
    };
    service = new NlConversationService(
      conversations as unknown as Repository<NlConversation>,
      turns as unknown as Repository<NlConversationTurn>,
      dataSource as unknown as DataSource,
    );
  });

  describe('historyFor', () => {
    it("404s when the conversation is not the caller's (or is deleted/unknown)", async () => {
      conversations.findOne.mockResolvedValue(null);
      await expect(service.historyFor(7, 'c1')).rejects.toBeInstanceOf(NotFoundException);
      expect(conversations.findOne).toHaveBeenCalledWith({
        where: { id: 'c1', userId: 7, deletedAt: expect.anything() as unknown },
      });
    });

    it('replays result/clarification/refusal turns in order with sql only for results', async () => {
      conversations.findOne.mockResolvedValue({ id: 'c1' } as never);
      // The service asks for newest-first and reverses, so feed DESC order.
      turns.find.mockResolvedValue([
        turnRow(2, envelope({ answer_type: 'result', sql: 'SELECT 2', row_count: 5 })),
        turnRow(1, envelope({ answer_type: 'clarification', sql: null, rows: null, row_count: 0 })),
      ] as never);

      await expect(service.historyFor(7, 'c1')).resolves.toEqual([
        { question: 'q1', answerType: 'clarification', sql: null, rowCount: 0 },
        { question: 'q2', answerType: 'result', sql: 'SELECT 2', rowCount: 5 },
      ]);
    });

    it('skips error envelopes and result turns without sql (upstream would reject them)', async () => {
      conversations.findOne.mockResolvedValue({ id: 'c1' } as never);
      turns.find.mockResolvedValue([
        turnRow(3, envelope({ answer_type: 'result', sql: 'SELECT 3' })),
        turnRow(2, envelope({ answer_type: 'result', sql: null })),
        turnRow(1, envelope({ status: 'error', sql: null, error: { code: 'x', message: 'm' } })),
      ] as never);

      const history = await service.historyFor(7, 'c1');
      expect(history).toEqual([
        { question: 'q3', answerType: 'result', sql: 'SELECT 3', rowCount: 1 },
      ]);
    });

    it('asks for at most the latest 50 turns', async () => {
      conversations.findOne.mockResolvedValue({ id: 'c1' } as never);
      turns.find.mockResolvedValue([] as never);
      await service.historyFor(7, 'c1');
      expect(turns.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { conversationId: 'c1' },
          order: { seq: 'DESC' },
          take: 50,
        }),
      );
    });
  });

  describe('appendTurn', () => {
    it('creates a conversation titled from the question when none is given', async () => {
      const id = await service.appendTurn(
        7,
        undefined,
        '  จำนวนนักเรียน\n  แยกตามโรงเรียน ',
        envelope(),
      );

      expect(id).toBe('c-new');
      expect(manager.create).toHaveBeenCalledWith(
        NlConversation,
        expect.objectContaining({ userId: 7, title: 'จำนวนนักเรียน แยกตามโรงเรียน' }),
      );
      expect(manager.create).toHaveBeenCalledWith(
        NlConversationTurn,
        expect.objectContaining({ conversationId: 'c-new', seq: 1, answerType: 'result' }),
      );
    });

    it('truncates long titles to 60 characters', async () => {
      await service.appendTurn(7, undefined, 'ก'.repeat(200), envelope());
      const call = manager.create.mock.calls.find((c: unknown[]) => c[0] === NlConversation) as [
        unknown,
        { title: string },
      ];
      expect(call[1].title).toHaveLength(60);
    });

    it('appends with the next seq under a row lock and touches updated_at', async () => {
      manager.findOne.mockResolvedValue({ id: 'c1', userId: 7 });
      manager.maximum.mockResolvedValue(3);

      await expect(service.appendTurn(7, 'c1', 'ต่อ', envelope())).resolves.toBe('c1');

      expect(manager.findOne).toHaveBeenCalledWith(
        NlConversation,
        expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
      );
      expect(manager.create).toHaveBeenCalledWith(
        NlConversationTurn,
        expect.objectContaining({ conversationId: 'c1', seq: 4 }),
      );
      expect(manager.update).toHaveBeenCalledWith(
        NlConversation,
        'c1',
        expect.objectContaining({ updatedAt: expect.any(Date) as Date }),
      );
    });

    it("404s when appending to someone else's conversation and writes nothing", async () => {
      manager.findOne.mockResolvedValue(null);
      await expect(service.appendTurn(7, 'c1', 'x', envelope())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('stores error envelopes with answer_type result as the fallback', async () => {
      await service.appendTurn(
        7,
        undefined,
        'x',
        envelope({ status: 'error', answer_type: undefined }),
      );
      expect(manager.create).toHaveBeenCalledWith(
        NlConversationTurn,
        expect.objectContaining({ answerType: 'result' }),
      );
    });
  });

  describe('list / get / rename / remove', () => {
    it("lists only the caller's live conversations, newest first, with a cursor", async () => {
      const rows = Array.from({ length: 3 }, (_, i) => ({
        id: `c${i}`,
        title: `t${i}`,
        createdAt: new Date('2026-10-01T00:00:00Z'),
        updatedAt: new Date(`2026-10-0${3 - i}T00:00:00Z`),
      }));
      conversations.find.mockResolvedValue(rows as never);

      const page = await service.list(7, { limit: 2 });

      expect(page.items.map((i) => i.id)).toEqual(['c0', 'c1']);
      expect(page.next_before).toBe('2026-10-02T00:00:00.000Z');
      expect(conversations.find).toHaveBeenCalledWith(expect.objectContaining({ take: 3 }));
    });

    it('returns null cursor when the page is not full', async () => {
      conversations.find.mockResolvedValue([] as never);
      await expect(service.list(7, { limit: 30 })).resolves.toEqual({
        items: [],
        next_before: null,
      });
    });

    it('get() returns turns in seq order and 404s for a stranger', async () => {
      conversations.findOne.mockResolvedValueOnce(null);
      await expect(service.get(7, 'c1')).rejects.toBeInstanceOf(NotFoundException);

      conversations.findOne.mockResolvedValueOnce({
        id: 'c1',
        title: 't',
        createdAt: new Date(0),
        updatedAt: new Date(0),
      } as never);
      turns.find.mockResolvedValue([turnRow(1, envelope())] as never);
      const detail = await service.get(7, 'c1');
      expect(detail.turns).toEqual([{ seq: 1, question: 'q1', envelope: envelope() }]);
      expect(turns.find).toHaveBeenCalledWith(expect.objectContaining({ order: { seq: 'ASC' } }));
    });

    it('rename() and remove() 404 when nothing was affected', async () => {
      conversations.update.mockResolvedValue({ affected: 0 } as never);
      await expect(service.rename(7, 'c1', 'ใหม่')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.remove(7, 'c1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
