import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, LessThan, type Repository } from 'typeorm';
import type { AnswerType, QueryEnvelope } from './dto/nl-query.dto';
import { NlConversation } from './entities/nl-conversation.entity';
import { NlConversationTurn } from './entities/nl-conversation-turn.entity';

export const HISTORY_REPLAY_LIMIT = 50;
const TITLE_MAX = 60;

export interface PriorTurnPayload {
  question: string;
  answerType: AnswerType;
  sql: string | null;
  rowCount: number | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationDetail extends ConversationSummary {
  turns: { seq: number; question: string; envelope: QueryEnvelope }[];
}

function toSummary(row: NlConversation): ConversationSummary {
  return {
    id: row.id,
    title: row.title,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function titleFrom(question: string): string {
  return Array.from(question.trim().replace(/\s+/g, ' ')).slice(0, TITLE_MAX).join('');
}

@Injectable()
export class NlConversationService {
  constructor(
    @InjectRepository(NlConversation)
    private readonly conversations: Repository<NlConversation>,
    @InjectRepository(NlConversationTurn)
    private readonly turns: Repository<NlConversationTurn>,
    private readonly dataSource: DataSource,
  ) {}

  /** Throws 404 for unknown, deleted, or someone else's conversation. */
  private async requireOwned(userId: number, id: string): Promise<NlConversation> {
    const row = await this.conversations.findOne({
      where: { id, userId, deletedAt: IsNull() },
    });
    if (!row) {
      throw new NotFoundException('ไม่พบบทสนทนา');
    }
    return row;
  }

  async historyFor(userId: number, conversationId: string): Promise<PriorTurnPayload[]> {
    await this.requireOwned(userId, conversationId);
    const latest = await this.turns.find({
      where: { conversationId },
      order: { seq: 'DESC' },
      take: HISTORY_REPLAY_LIMIT,
    });
    return latest
      .reverse()
      .filter(({ envelope, answerType }) => {
        if (envelope.status === 'error') return false;
        return answerType !== 'result' || Boolean(envelope.sql);
      })
      .map(({ question, answerType, envelope }) => ({
        question,
        answerType,
        sql: answerType === 'result' ? envelope.sql : null,
        rowCount: envelope.row_count,
      }));
  }

  async appendTurn(
    userId: number,
    conversationId: string | undefined,
    question: string,
    envelope: QueryEnvelope,
  ): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      let id: string;
      if (conversationId) {
        const owned = await manager.findOne(NlConversation, {
          where: { id: conversationId, userId, deletedAt: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });
        if (!owned) {
          throw new NotFoundException('ไม่พบบทสนทนา');
        }
        id = owned.id;
      } else {
        const now = new Date();
        const created = await manager.save(
          NlConversation,
          manager.create(NlConversation, {
            userId,
            title: titleFrom(question),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          }),
        );
        id = created.id;
      }

      const max = await manager.maximum(NlConversationTurn, 'seq', { conversationId: id });
      const now = new Date();
      await manager.save(
        NlConversationTurn,
        manager.create(NlConversationTurn, {
          conversationId: id,
          seq: (max ?? 0) + 1,
          question,
          answerType: envelope.answer_type ?? 'result',
          envelope,
          createdAt: now,
        }),
      );
      await manager.update(NlConversation, id, { updatedAt: now });
      return id;
    });
  }

  async list(
    userId: number,
    options: { limit: number; before?: string },
  ): Promise<{ items: ConversationSummary[]; next_before: string | null }> {
    const rows = await this.conversations.find({
      where: {
        userId,
        deletedAt: IsNull(),
        ...(options.before ? { updatedAt: LessThan(new Date(options.before)) } : {}),
      },
      order: { updatedAt: 'DESC' },
      take: options.limit + 1,
    });
    const page = rows.slice(0, options.limit);
    const hasMore = rows.length > options.limit;
    return {
      items: page.map(toSummary),
      next_before: hasMore ? page[page.length - 1].updatedAt.toISOString() : null,
    };
  }

  async get(userId: number, id: string): Promise<ConversationDetail> {
    const row = await this.requireOwned(userId, id);
    const turns = await this.turns.find({
      where: { conversationId: id },
      order: { seq: 'ASC' },
    });
    return {
      ...toSummary(row),
      turns: turns.map(({ seq, question, envelope }) => ({ seq, question, envelope })),
    };
  }

  async rename(userId: number, id: string, title: string): Promise<ConversationSummary> {
    const result = await this.conversations.update(
      { id, userId, deletedAt: IsNull() },
      { title, updatedAt: new Date() },
    );
    if (!result.affected) {
      throw new NotFoundException('ไม่พบบทสนทนา');
    }
    return toSummary(await this.requireOwned(userId, id));
  }

  async remove(userId: number, id: string): Promise<void> {
    const result = await this.conversations.update(
      { id, userId, deletedAt: IsNull() },
      { deletedAt: new Date() },
    );
    if (!result.affected) {
      throw new NotFoundException('ไม่พบบทสนทนา');
    }
  }
}
