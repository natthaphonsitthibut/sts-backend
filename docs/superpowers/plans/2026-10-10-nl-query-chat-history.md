# NL-Query Chat History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users keep, reopen, rename and delete their past nl-query chat conversations, and continue an old conversation with correct context.

**Architecture:** Backend persists conversations (`nl_conversation`) and their turns (`nl_conversation_turn`, one full `QueryEnvelope` per turn) per user. `POST /api/nl-query` takes an optional `conversationId`; the server derives the upstream `history` from stored turns instead of trusting the client. Frontend gets a history sidebar, a `/nl-query/:conversationId?` route, and `useNlQuery` learns `load(id)` and sends `conversationId`.

**Tech Stack:** NestJS 11 + TypeORM 0.3 + Postgres + Jest (backend, `sts-backend`); React + react-router-dom 7 + @tanstack/react-query 5 + Vitest (frontend, `sts-frontend`, a separate repo at `../sts-frontend`).

**Spec:** none written. Design decisions are the "Global Constraints" below (agreed in chat on 2026-10-10).

## Global Constraints

- Permission stays `nl_query:use` for every new endpoint; no new permission, no permission migration.
- A user sees and touches only their own conversations. Another user's id, a deleted id, or an unknown id all return **404** (never 403) so existence is not leaked.
- Full `QueryEnvelope` including `rows` is stored (decision 1, recommended option). Retention is **out of scope** (no auto-delete in this plan); users can delete their own conversations (soft delete via `deleted_at`).
- Conversation title = first question, whitespace-collapsed, truncated to 60 chars; rename limit 120 chars.
- At most 50 prior turns are replayed as upstream history (matches the existing `ArrayMaxSize(50)`).
- A turn whose envelope has `status === 'error'`, or `answer_type` result with no `sql`, is stored and shown but **not** replayed as history (the upstream `PriorTurnDto` validation rejects it).
- Persisting a turn must never lose the answer: on a persistence error, log it and still return the envelope (same stance as `log.complete`).
- Backend code style: single quotes, 2-space indent, `.js`-less relative imports (see existing `src/nl-query/*`). Frontend: double quotes, Thai UI copy.
- Out of scope: search, sharing, export, streaming, retention job, admin view of others' history.

## Review Focus

- Open conversation id owned by someone else → 404, no leak. (Task 2, Task 3)
- Two tabs append to the same conversation at once → distinct `seq`, no unique-violation 500. (Task 2)
- Continuing a conversation whose last turn was an upstream error → request still succeeds (error turn not replayed). (Task 2)
- Upstream fails (502) on a continued conversation → nothing persisted, no empty conversation created for a first question. (Task 3)
- Stale `load()` resolving after the user clicked "แชตใหม่" must not resurrect the old chat. (Task 4)
- Opening `/nl-query/<bad-or-foreign-id>` → friendly error and fall back to `/nl-query`, no crash. (Task 5)

---

### Task 1: Schema — migration, entities, registration

**Files:**
- Create: `src/database/migrations/20261010100000-AddNlConversations.ts`
- Create: `src/database/add-nl-conversations.migration.spec.ts`
- Create: `src/nl-query/entities/nl-conversation.entity.ts`
- Create: `src/nl-query/entities/nl-conversation-turn.entity.ts`
- Modify: `src/database/entities/index.ts` (import + both lists that currently contain `NlQueryLog`, around lines 31/54/96)
- Modify: `src/nl-query/entities/nl-query-log.entity.ts` (add `conversationId`)
- Modify: `src/nl-query/nl-query.module.ts`

**Interfaces:**
- Produces: entities `NlConversation { id: string; userId: number; title: string; createdAt: Date; updatedAt: Date; deletedAt: Date | null }`, `NlConversationTurn { id: string; conversationId: string; seq: number; question: string; answerType: AnswerType; envelope: QueryEnvelope; createdAt: Date }`, and `NlQueryLog.conversationId: string | null`.

- [ ] **Step 1: Write the failing migration spec**

`src/database/add-nl-conversations.migration.spec.ts`:

```ts
import { AddNlConversations20261010100000 } from './migrations/20261010100000-AddNlConversations';

function runner() {
  const queries: string[] = [];
  return {
    queries,
    query: jest.fn((sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    }),
  };
}

describe('AddNlConversations migration', () => {
  it('creates both tables, the ownership index and the audit link', async () => {
    const r = runner();
    await new AddNlConversations20261010100000().up(r as never);
    const sql = r.queries.join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS nl_conversation ');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS nl_conversation_turn');
    expect(sql).toContain('REFERENCES users(id) ON DELETE CASCADE');
    expect(sql).toContain('UNIQUE (conversation_id, seq)');
    expect(sql).toContain('(user_id, updated_at DESC) WHERE deleted_at IS NULL');
    expect(sql).toContain('ALTER TABLE nl_query_log');
    expect(sql).toContain('conversation_id UUID NULL');
  });

  it('down() removes the audit link before dropping the tables', async () => {
    const r = runner();
    await new AddNlConversations20261010100000().down(r as never);
    const sql = r.queries.join('\n');

    expect(sql.indexOf('DROP COLUMN IF EXISTS conversation_id')).toBeGreaterThanOrEqual(0);
    expect(sql.indexOf('DROP COLUMN IF EXISTS conversation_id')).toBeLessThan(
      sql.indexOf('DROP TABLE IF EXISTS nl_conversation_turn'),
    );
    expect(sql.indexOf('DROP TABLE IF EXISTS nl_conversation_turn')).toBeLessThan(
      sql.indexOf('DROP TABLE IF EXISTS nl_conversation;'),
    );
  });
});
```

- [ ] **Step 2: Run it, expect FAIL (module not found)**

Run: `pnpm jest src/database/add-nl-conversations.migration.spec.ts`
Expected: FAIL `Cannot find module './migrations/20261010100000-AddNlConversations'`

- [ ] **Step 3: Write the migration**

`src/database/migrations/20261010100000-AddNlConversations.ts`:

```ts
import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-user nl-query chat history. One row per conversation, one row per turn
 * holding the full QueryEnvelope (decision: rows are stored; no retention job).
 */
export class AddNlConversations20261010100000 implements MigrationInterface {
  name = 'AddNlConversations20261010100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS nl_conversation (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(120) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ NULL
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_nl_conversation_user_updated
        ON nl_conversation (user_id, updated_at DESC) WHERE deleted_at IS NULL
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS nl_conversation_turn (
        id BIGSERIAL PRIMARY KEY,
        conversation_id UUID NOT NULL REFERENCES nl_conversation(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        question TEXT NOT NULL,
        answer_type VARCHAR(16) NOT NULL,
        envelope JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT uq_nl_conversation_turn_seq UNIQUE (conversation_id, seq),
        CONSTRAINT chk_nl_conversation_turn_answer_type
          CHECK (answer_type IN ('result', 'clarification', 'refusal'))
      )
    `);
    await queryRunner.query(`
      ALTER TABLE nl_query_log
        ADD COLUMN IF NOT EXISTS conversation_id UUID NULL
          REFERENCES nl_conversation(id) ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE nl_query_log DROP COLUMN IF EXISTS conversation_id`);
    await queryRunner.query(`DROP TABLE IF EXISTS nl_conversation_turn`);
    await queryRunner.query(`DROP TABLE IF EXISTS nl_conversation;`);
  }
}
```

- [ ] **Step 4: Run spec, expect PASS**

Run: `pnpm jest src/database/add-nl-conversations.migration.spec.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Add entities**

`src/nl-query/entities/nl-conversation.entity.ts`:

```ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'nl_conversation' })
export class NlConversation {
  @PrimaryGeneratedColumn('uuid', { name: 'id' })
  id!: string;

  @Column({ name: 'user_id', type: 'integer' })
  userId!: number;

  @Column({ name: 'title', type: 'varchar', length: 120 })
  title!: string;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @Column({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}
```

`src/nl-query/entities/nl-conversation-turn.entity.ts`:

```ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import type { AnswerType, QueryEnvelope } from '../dto/nl-query.dto';

@Entity({ name: 'nl_conversation_turn' })
export class NlConversationTurn {
  @PrimaryGeneratedColumn('increment', { name: 'id', type: 'bigint' })
  id!: string;

  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  @Column({ name: 'seq', type: 'integer' })
  seq!: number;

  @Column({ name: 'question', type: 'text' })
  question!: string;

  @Column({ name: 'answer_type', type: 'varchar', length: 16 })
  answerType!: AnswerType;

  @Column({ name: 'envelope', type: 'jsonb' })
  envelope!: QueryEnvelope;

  @Column({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

In `nl-query-log.entity.ts` add after `dataScope`:

```ts
  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId!: string | null;
```

- [ ] **Step 6: Register entities**

In `src/database/entities/index.ts` import both new entities next to `NlQueryLog` and add `NlConversation, NlConversationTurn` right after `NlQueryLog` in **both** places `NlQueryLog` appears in the file (the `DATABASE_ENTITIES` array and the later export list). In `nl-query.module.ts` change `TypeOrmModule.forFeature([NlQueryLog])` to `forFeature([NlQueryLog, NlConversation, NlConversationTurn])` (providers are added in Task 2).

- [ ] **Step 7: Apply migration to the local DB and verify**

Run: `pnpm migration:run && docker exec sts-postgres psql -U postgres -d sts -c '\d nl_conversation_turn'`
Expected: migration `AddNlConversations20261010100000` executed; table shows the unique constraint on `(conversation_id, seq)`. (If `gen_random_uuid()` is missing, Postgres < 13: add `CREATE EXTENSION IF NOT EXISTS pgcrypto;` as the first query and re-run the spec's `toContain` list.)

- [ ] **Step 8: Typecheck and parity**

Run: `pnpm build && pnpm bootstrap:verify-parity`
Expected: both succeed. If parity fails on the new tables, follow the failure message (the script compares bootstrap SQL with migrations).

- [ ] **Step 9: Commit**

```bash
git add src/database src/nl-query/entities src/nl-query/nl-query.module.ts
git commit -m "feat(nl-query): add conversation tables"
```

---

### Task 2: `NlConversationService` — ownership, history, append

**Files:**
- Create: `src/nl-query/nl-conversation.service.ts`
- Create: `src/nl-query/nl-conversation.service.spec.ts`
- Modify: `src/nl-query/nl-query.module.ts` (add provider + export nothing)

**Interfaces:**
- Consumes: entities from Task 1; `QueryEnvelope`, `AnswerType` from `dto/nl-query.dto`.
- Produces (used by Task 3):
  - `historyFor(userId: number, conversationId: string): Promise<PriorTurnPayload[]>` where `PriorTurnPayload = { question: string; answerType: AnswerType; sql: string | null; rowCount: number | null }`; throws `NotFoundException` if not owned/deleted/unknown.
  - `appendTurn(userId: number, conversationId: string | undefined, question: string, envelope: QueryEnvelope): Promise<string>` returns the conversation id (creates the conversation when `conversationId` is undefined).
  - `list(userId, { limit, before }): Promise<{ items: ConversationSummary[]; next_before: string | null }>`
  - `get(userId, id): Promise<ConversationDetail>`
  - `rename(userId, id, title): Promise<ConversationSummary>`
  - `remove(userId, id): Promise<void>`
  - `ConversationSummary = { id: string; title: string; created_at: string; updated_at: string }`, `ConversationDetail = ConversationSummary & { turns: { seq: number; question: string; envelope: QueryEnvelope }[] }`.

The service uses an injected `DataSource` for the one transactional operation (`appendTurn`) and `Repository`s for reads. Locking the conversation row (`pessimistic_write`) while computing `MAX(seq)+1` is what prevents the two-tab race.

- [ ] **Step 1: Write failing tests**

`src/nl-query/nl-conversation.service.spec.ts` (mock style follows `nl-query-log.service.spec.ts`):

```ts
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
      save: jest.fn((_entity: unknown, value: object) => Promise.resolve({ id: 'c-new', ...value })),
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
    it('404s when the conversation is not the caller\'s (or is deleted/unknown)', async () => {
      conversations.findOne.mockResolvedValue(null);
      await expect(service.historyFor(7, 'c1')).rejects.toBeInstanceOf(NotFoundException);
      expect(conversations.findOne).toHaveBeenCalledWith({
        where: { id: 'c1', userId: 7, deletedAt: expect.anything() as unknown },
      });
    });

    it('replays result/clarification/refusal turns in order with sql only for results', async () => {
      conversations.findOne.mockResolvedValue({ id: 'c1' });
      turns.find.mockResolvedValue([
        turnRow(1, envelope({ answer_type: 'clarification', sql: null, rows: null, row_count: 0 })),
        turnRow(2, envelope({ answer_type: 'result', sql: 'SELECT 2', row_count: 5 })),
      ] as never);

      await expect(service.historyFor(7, 'c1')).resolves.toEqual([
        { question: 'q1', answerType: 'clarification', sql: null, rowCount: 0 },
        { question: 'q2', answerType: 'result', sql: 'SELECT 2', rowCount: 5 },
      ]);
    });

    it('skips error envelopes and result turns without sql (upstream would reject them)', async () => {
      conversations.findOne.mockResolvedValue({ id: 'c1' });
      turns.find.mockResolvedValue([
        turnRow(1, envelope({ status: 'error', sql: null, error: { code: 'x', message: 'm' } })),
        turnRow(2, envelope({ answer_type: 'result', sql: null })),
        turnRow(3, envelope({ answer_type: 'result', sql: 'SELECT 3' })),
      ] as never);

      const history = await service.historyFor(7, 'c1');
      expect(history).toEqual([{ question: 'q3', answerType: 'result', sql: 'SELECT 3', rowCount: 1 }]);
    });

    it('asks for at most the latest 50 turns', async () => {
      conversations.findOne.mockResolvedValue({ id: 'c1' });
      turns.find.mockResolvedValue([] as never);
      await service.historyFor(7, 'c1');
      expect(turns.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { conversationId: 'c1' }, order: { seq: 'DESC' }, take: 50 }),
      );
    });
  });

  describe('appendTurn', () => {
    it('creates a conversation titled from the question when none is given', async () => {
      const id = await service.appendTurn(7, undefined, '  จำนวนนักเรียน\n  แยกตามโรงเรียน ', envelope());

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
      const call = manager.create.mock.calls.find((c) => c[0] === NlConversation) as [unknown, { title: string }];
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

    it('404s when appending to someone else\'s conversation and writes nothing', async () => {
      manager.findOne.mockResolvedValue(null);
      await expect(service.appendTurn(7, 'c1', 'x', envelope())).rejects.toBeInstanceOf(NotFoundException);
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('stores error envelopes with answer_type result as the fallback', async () => {
      await service.appendTurn(7, undefined, 'x', envelope({ status: 'error', answer_type: undefined }));
      expect(manager.create).toHaveBeenCalledWith(
        NlConversationTurn,
        expect.objectContaining({ answerType: 'result' }),
      );
    });
  });

  describe('list / get / rename / remove', () => {
    it('lists only the caller\'s live conversations, newest first, with a cursor', async () => {
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
      await expect(service.list(7, { limit: 30 })).resolves.toEqual({ items: [], next_before: null });
    });

    it('get() returns turns in seq order and 404s for a stranger', async () => {
      conversations.findOne.mockResolvedValueOnce(null);
      await expect(service.get(7, 'c1')).rejects.toBeInstanceOf(NotFoundException);

      conversations.findOne.mockResolvedValueOnce({
        id: 'c1', title: 't', createdAt: new Date(0), updatedAt: new Date(0),
      });
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
```

- [ ] **Step 2: Run, expect FAIL (cannot find module)**

Run: `pnpm jest src/nl-query/nl-conversation.service.spec.ts`
Expected: FAIL `Cannot find module './nl-conversation.service'`

- [ ] **Step 3: Implement**

`src/nl-query/nl-conversation.service.ts`:

```ts
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
```

Note on the `rename` test: the spec's `update` mock returns `{ affected: 0 }` so it never reaches `requireOwned`. Note on `list`: renaming bumps `updated_at` and moves the chat to the top — acceptable and intended (most recently touched first).

- [ ] **Step 4: Register provider**

In `nl-query.module.ts` add `NlConversationService` to `providers`.

- [ ] **Step 5: Run spec, expect PASS; fix any test-vs-impl drift in the test mocks only (assertions describe the required behavior)**

Run: `pnpm jest src/nl-query/nl-conversation.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/nl-query
git commit -m "feat(nl-query): conversation service with ownership and history replay"
```

---

### Task 3: API — DTOs, controller endpoints, `POST` uses `conversationId`

**Files:**
- Modify: `src/nl-query/dto/nl-query.dto.ts`
- Modify: `src/nl-query/nl-query.controller.ts`
- Modify: `src/nl-query/nl-query.service.ts`
- Modify: `src/nl-query/nl-query-log.service.ts`
- Modify: `src/nl-query/nl-query.controller.spec.ts`, `nl-query.service.spec.ts`, `nl-query-log.service.spec.ts`, `dto/nl-query.dto.spec.ts`

**Interfaces:**
- Consumes: `NlConversationService` from Task 2.
- Produces (HTTP, consumed by Task 4):
  - `POST /api/nl-query` body adds `conversationId?: string (uuid)`; response is `QueryEnvelope & { conversation_id: string | null }`. The legacy `history` field is still accepted and **ignored**.
  - `GET /api/nl-query/conversations?limit=&before=` → `{ items: ConversationSummary[]; next_before: string | null }`
  - `GET /api/nl-query/conversations/:id` → `ConversationDetail`
  - `PATCH /api/nl-query/conversations/:id` body `{ title }` → `ConversationSummary`
  - `DELETE /api/nl-query/conversations/:id` → 204

- [ ] **Step 1: Failing DTO tests** — in `dto/nl-query.dto.spec.ts` (follow its existing `validate`/`plainToInstance` style) add: `conversationId` accepts a uuid and rejects `'abc'`; `RenameConversationDto` rejects empty/whitespace-only and >120-char titles and trims; `ListConversationsQueryDto` defaults nothing, rejects `limit=0` and `limit=51`, rejects a non-ISO `before`.

- [ ] **Step 2: Add DTOs** to `dto/nl-query.dto.ts`:

```ts
// in NlQueryDto
  @IsOptional()
  @IsUUID()
  conversationId?: string;

export class RenameConversationDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;
}

export class ListConversationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsISO8601()
  before?: string;
}

export type NlQueryResponse = QueryEnvelope & { conversation_id: string | null };
```

(import `Transform` from `class-transformer`; `IsUUID`, `IsISO8601`, `Max` from `class-validator`.)

- [ ] **Step 3: Failing service tests** in `nl-query.service.spec.ts` (add `conversations` mock `{ historyFor, appendTurn }` to `beforeEach` and to the constructor call):
  - with `conversationId: 'c1'` the upstream body's `history` equals what `historyFor(7,'c1')` returned, and a client-sent `history` is ignored;
  - without `conversationId`, upstream `history` is `[]` and `historyFor` is not called;
  - `historyFor` rejecting with `NotFoundException` → thrown **before** `log.begin` and before `fetch` (assert both not called);
  - success → `appendTurn(7, 'c1' | undefined, question, envelope)` called once and the result carries `conversation_id`;
  - `appendTurn` rejects → envelope still returned, `conversation_id` is `dto.conversationId ?? null`, error logged;
  - upstream failure (502 path) → `appendTurn` **not** called (Review Focus: no empty conversation);
  - `log.complete` receives `conversationId`.

- [ ] **Step 4: Implement service changes** in `nl-query.service.ts`: inject `NlConversationService` as third constructor arg; in `query()`:

```ts
const history = dto.conversationId
  ? await this.conversations.historyFor(user.id, dto.conversationId)
  : [];
// ... log.begin as today ...
// upstream body: history: history.map((t) => ({ question: t.question, answer_type: t.answerType, sql: t.sql, row_count: t.rowCount })),
// after envelope is obtained:
let conversationId: string | null = dto.conversationId ?? null;
try {
  conversationId = await this.conversations.appendTurn(user.id, dto.conversationId, dto.question, envelope);
} catch (error) {
  this.logError(`nl_conversation.appendTurn failed (logId=${logId})`, error);
}
// log.complete({... conversationId}) then:
return { ...envelope, conversation_id: conversationId };
```

Order: do `appendTurn` before `log.complete` so the audit row records the conversation. Change the return type to `NlQueryResponse`. In `nl-query-log.service.ts` add `conversationId: string | null` to `CompleteNlQueryLogInput` and to the `update` payload; extend `nl-query-log.service.spec.ts` (`complete` test expects `conversationId` passed through, plus a case with `null`).

- [ ] **Step 5: Run service + log specs, expect PASS**

Run: `pnpm jest src/nl-query`
Expected: PASS

- [ ] **Step 6: Controller** — add endpoints (inject `NlConversationService`; `ParseUUIDPipe` for `:id`; do **not** add `@ThrottleNlQuery()` to reads):

```ts
@Get('conversations')
@RequirePermission('nl_query:use')
listConversations(@CurrentUser() user: AuthenticatedRequestUser, @Query() query: ListConversationsQueryDto) {
  return this.conversations.list(user.id, { limit: query.limit ?? 30, before: query.before });
}

@Get('conversations/:id')
@RequirePermission('nl_query:use')
getConversation(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string) {
  return this.conversations.get(user.id, id);
}

@Patch('conversations/:id')
@RequirePermission('nl_query:use')
renameConversation(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenameConversationDto) {
  return this.conversations.rename(user.id, id, dto.title);
}

@Delete('conversations/:id')
@HttpCode(204)
@RequirePermission('nl_query:use')
async deleteConversation(@CurrentUser() user: AuthenticatedRequestUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
  await this.conversations.remove(user.id, id);
}
```

Declare these **after** `schema()`; paths do not collide with `schema`. Extend `nl-query.controller.spec.ts`: for each new handler assert `PERMISSIONS_KEY` metadata equals `['nl_query:use']`, and add behavior tests that each handler calls the service with `user.id` (never a value from the request body/query) — this pins "caller scoping" at the controller seam.

- [ ] **Step 7: Run all nl-query specs, lint, build**

Run: `pnpm jest src/nl-query src/database/add-nl-conversations.migration.spec.ts && pnpm lint && pnpm build`
Expected: all pass; no lint errors (note `lint` runs `--fix`; review the diff it makes).

- [ ] **Step 8: Manual smoke against the local stack** (needs the backend running with `TEXT_TO_SQL_URL` set; if the upstream service is not available locally, skip the POST step and verify the read/rename/delete endpoints by inserting a row with `psql`)

Run: log in as `newnew`, then `curl` list → empty; create via POST (or psql insert); list → 1 item; GET by id → turns; PATCH rename; DELETE → 204; GET → 404; GET with another user's token → 404.

- [ ] **Step 9: Commit**

```bash
git add src/nl-query
git commit -m "feat(nl-query): conversation endpoints and server-derived history"
```

---

### Task 4: Frontend data layer — types, API, hooks

**Repo:** `../sts-frontend` (separate git repo; commit there).

**Files:**
- Modify: `src/features/nl-query/types/nl-query.types.ts`
- Modify: `src/features/nl-query/api/nl-query.service.ts`
- Modify: `src/features/nl-query/hooks/useNlQuery.ts`
- Modify: `src/features/nl-query/hooks/useNlQuery.test.ts`
- Create: `src/features/nl-query/hooks/useNlConversations.ts`

**Interfaces:**
- Consumes: HTTP contract from Task 3.
- Produces (used by Task 5):
  - types `ConversationSummary`, `ConversationDetail`, `ConversationPage`, `NlQueryResponse = QueryEnvelope & { conversation_id: string | null }`; `NlQueryPayload` becomes `{ question: string; preferredChartType?: ChartType; conversationId?: string }` (the `history`/`UiTurn`/`PriorTurnDto` types are deleted).
  - api: `listNlConversations(params?: { limit?: number; before?: string }): Promise<ConversationPage>`, `getNlConversation(id): Promise<ConversationDetail>`, `renameNlConversation(id, title): Promise<ConversationSummary>`, `deleteNlConversation(id): Promise<void>`; `askNlQuery` now returns `NlQueryResponse`.
  - `useNlQuery()` returns `{ ask, load, turnsLog, conversationId, loading, error, reset }` where `load(id: string): Promise<boolean>`.
  - `useNlConversations()` returns `{ conversations, isLoading, isError, hasNextPage, fetchNextPage, rename, remove }` (react-query; query key `["nl-conversations"]`), and exports `NL_CONVERSATIONS_KEY`.

- [ ] **Step 1: Rewrite the failing hook tests.** In `useNlQuery.test.ts` (mock `../api/nl-query.service` with `askNlQuery` and `getNlConversation`), replace the history-based tests with:
  - first `ask` sends `{ question, preferredChartType: undefined, conversationId: undefined }`; the response's `conversation_id: "c1"` becomes `result.current.conversationId`; the second `ask` sends `conversationId: "c1"`;
  - a transport error leaves `turnsLog` empty and the next `ask` still sends the previous `conversationId` (undefined if none);
  - `load("c1")` fills `turnsLog` from `detail.turns` (`{question, envelope}`), sets `conversationId`, returns `true`;
  - `load` failure sets `error`, returns `false`, leaves state untouched;
  - **stale guard:** `load` pending → `reset()` → `load` resolves ⇒ `turnsLog` stays empty and `conversationId` stays `null` (Review Focus);
  - the existing `reset()` clears turns/error test and the stale in-flight `ask` test stay, extended to assert `conversationId` is `null` after reset.

  Update the `envelope()` helper to return `NlQueryResponse` (`conversation_id: null` default).

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm vitest run src/features/nl-query/hooks/useNlQuery.test.ts`
Expected: FAIL (no `load`, `conversationId`)

- [ ] **Step 3: Types and API.** Edit `nl-query.types.ts` per the Interfaces block above; `nl-query.service.ts` additions:

```ts
export async function listNlConversations(params?: { limit?: number; before?: string }) {
  const response = await apiClient.get<ConversationPage>("/nl-query/conversations", { params });
  return response.data;
}
export async function getNlConversation(id: string) {
  const response = await apiClient.get<ConversationDetail>(`/nl-query/conversations/${id}`);
  return response.data;
}
export async function renameNlConversation(id: string, title: string) {
  const response = await apiClient.patch<ConversationSummary>(`/nl-query/conversations/${id}`, { title });
  return response.data;
}
export async function deleteNlConversation(id: string) {
  await apiClient.delete(`/nl-query/conversations/${id}`);
}
```

and `askNlQuery` is typed `apiClient.post<NlQueryResponse>`.

- [ ] **Step 4: Rewrite `useNlQuery`.** Remove `toTurn`/`turns`; keep `sessionRef` stale-guard. Core:

```ts
const [turnsLog, setTurnsLog] = useState<TurnLogEntry[]>([]);
const [conversationId, setConversationId] = useState<string | null>(null);
// ask(): payload { question, preferredChartType: chart, conversationId: conversationId ?? undefined }
//   on success (and session unchanged): setTurnsLog(log => [...log, { question, envelope }]);
//   if (envelope.conversation_id) setConversationId(envelope.conversation_id);
const load = useCallback(async (id: string): Promise<boolean> => {
  const session = ++sessionRef.current;       // a load supersedes any in-flight ask/load
  setLoading(true); setError(null);
  try {
    const detail = await getNlConversation(id);
    if (sessionRef.current !== session) return false;
    setTurnsLog(detail.turns.map(({ question, envelope }) => ({ question, envelope })));
    setConversationId(id);
    return true;
  } catch (thrown) {
    if (sessionRef.current === session) setError(thrown);
    return false;
  } finally {
    if (sessionRef.current === session) setLoading(false);
  }
}, []);
// reset(): also setConversationId(null)
```

`TurnLogEntry.envelope` stays `QueryEnvelope` (extra `conversation_id` field is harmless).

- [ ] **Step 5: `useNlConversations.ts`** (react-query v5 infinite query):

```ts
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export const NL_CONVERSATIONS_KEY = ["nl-conversations"] as const;

export function useNlConversations() {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: NL_CONVERSATIONS_KEY,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => listNlConversations({ before: pageParam }),
    getNextPageParam: (last) => last.next_before ?? undefined,
  });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: NL_CONVERSATIONS_KEY });
  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => renameNlConversation(id, title),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: string) => deleteNlConversation(id), onSuccess: invalidate });
  return {
    conversations: query.data?.pages.flatMap((page) => page.items) ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    hasNextPage: query.hasNextPage,
    fetchNextPage: query.fetchNextPage,
    rename,
    remove,
  };
}
```

- [ ] **Step 6: Run hook tests + typecheck**

Run: `pnpm vitest run src/features/nl-query && pnpm exec tsc -b`
Expected: hook tests PASS. `tsc` will flag `NlQueryPage.tsx` only if it used removed types; it does not (it consumes `useNlQuery`'s return only), so expect clean.

- [ ] **Step 7: Commit (in sts-frontend)**

```bash
git add src/features/nl-query
git commit -m "feat(nl-query): conversation api and hooks"
```

---

### Task 5: Frontend UI — history sidebar and routing

**Repo:** `../sts-frontend`

**Files:**
- Create: `src/features/nl-query/components/ConversationSidebar.tsx`
- Create: `src/features/nl-query/components/ConversationSidebar.test.tsx`
- Modify: `src/features/nl-query/pages/NlQueryPage.tsx`
- Modify: `src/features/nl-query/pages/NlQueryPage.test.tsx`
- Modify: `src/app/router.tsx` (add `nl-query/:conversationId` sibling route using the same `protectedElement(<NlQueryPage />, "nl_query:use")`)

**Interfaces:**
- Consumes: `useNlConversations`, `useNlQuery` (Task 4); base components `Button`, `Input`, `IconButton`, `Sheet`, `SheetHeader`, `useConfirm` from `components/base`.
- Produces: `<ConversationSidebar activeId={string | null} onSelect={(id) => void} onNew={() => void} onDeleted={(id) => void} />`.

Behavior contract for the page:
- Route param `conversationId` is the source of truth for "which chat is open". An effect calls `load(conversationId)` when the param is set **and** differs from the hook's `conversationId`; when it returns `false` it navigates to `/nl-query` (`replace`) and shows the transport error alert (the hook's `error` is already set; `transportErrorMessage` gets a 404 branch: "ไม่พบบทสนทนานี้").
- After the first answer of a new chat the hook's `conversationId` becomes non-null while the URL has none → `navigate(`/nl-query/${id}`, { replace: true })`; because hook id === param, the load effect does nothing (no refetch).
- "แชตใหม่" → `reset()` + `navigate("/nl-query")`. The existing toolbar button "เริ่มบทสนทนาใหม่" is kept and does the same.
- After each answered question, invalidate `NL_CONVERSATIONS_KEY` (page-level `useQueryClient`), so the list shows the new/bumped chat.
- Deleting the open conversation → `reset()` + `navigate("/nl-query")`.
- Layout: `lg:` two columns (sidebar `w-64`, chat card flex-1); below `lg` the sidebar lives in `Sheet` opened by a "ประวัติ" button in the toolbar (`Sheet` is `lg:hidden` already; its close button label is the shared "Close navigation").

- [ ] **Step 1: Failing sidebar tests** (`ConversationSidebar.test.tsx`, mock `../hooks/useNlConversations`): renders titles; clicking one calls `onSelect(id)`; active one has `aria-current="true"`; empty state text "ยังไม่มีประวัติการสนทนา"; rename: click rename icon → input prefilled → Enter calls `rename.mutate({id, title})`; blank title is not submitted; delete: click delete → confirm dialog → on confirm calls `remove.mutateAsync(id)` then `onDeleted(id)`; cancel does nothing; "โหลดเพิ่มเติม" button shown only when `hasNextPage`.

- [ ] **Step 2: Run, expect FAIL**

Run: `pnpm vitest run src/features/nl-query/components/ConversationSidebar.test.tsx`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `ConversationSidebar`** — a list of `<li>`; each row is a `button` (title, truncated, `aria-current={active ? "true" : undefined}`) plus two `IconButton`s (`Pencil` "เปลี่ยนชื่อ", `Trash2` "ลบ"); renaming swaps the title for an `Input` (Enter submits trimmed non-empty, Esc cancels); delete uses `const { confirm, dialog } = useConfirm()` with `{ title: "ลบบทสนทนานี้?", description: "ประวัติของบทสนทนานี้จะถูกลบและกู้คืนไม่ได้", confirmText: "ลบ", variant: "destructive" }` and renders `{dialog}` once. Header row has a "แชตใหม่" `Button` calling `onNew`. Loading → `Skeleton` rows; error → small `Alert` "โหลดประวัติไม่สำเร็จ".

- [ ] **Step 4: Run sidebar tests, expect PASS**

Run: `pnpm vitest run src/features/nl-query/components/ConversationSidebar.test.tsx`

- [ ] **Step 5: Failing page tests.** In `NlQueryPage.test.tsx` add `vi.mock("../components/ConversationSidebar", () => ({ ConversationSidebar: () => <div data-testid="sidebar" /> }))`, add `conversationId: null, load: vi.fn()` to `sessionState`, wrap `renderPage` in a `QueryClientProvider`, and use `<Routes>` with both `/nl-query` and `/nl-query/:conversationId`. New tests:
  - visiting `/nl-query/abc` calls `load("abc")` once;
  - `load` resolving `false` navigates to `/nl-query` (assert the location via a `LocationDisplay` helper component or `data-testid`);
  - when the hook reports `conversationId: "new1"` while on `/nl-query`, the URL becomes `/nl-query/new1` and `load` is **not** called;
  - visiting `/nl-query/abc` with hook `conversationId: "abc"` does not call `load`;
  - the toolbar "เริ่มบทสนทนาใหม่" button calls `reset` and returns to `/nl-query`.

  Existing page tests (height measurement, example chips, pending question, error focus) must keep passing unchanged.

- [ ] **Step 6: Implement page + route changes** per the behavior contract. Keep the existing chat card markup and helpers; wrap it as `<div className="flex gap-4"><aside className="hidden w-64 shrink-0 lg:block"><ConversationSidebar .../></aside><div className="min-w-0 flex-1">…existing Card…</div></div>`, plus the `Sheet` variant for small screens. Add the 404 branch to `transportErrorMessage`. Add the router entry:

```tsx
{
  path: "nl-query/:conversationId",
  element: protectedElement(<NlQueryPage />, "nl_query:use"),
},
```

(Both routes render the same element type, but React Router remounts per route object; to avoid remounting `NlQueryPage` — and losing the in-memory chat — when the URL changes from `/nl-query` to `/nl-query/:id` after the first answer, use one route with an optional segment instead: `path: "nl-query/:conversationId?"`. React Router 7 supports optional segments. Prefer this and drop the second entry.)

- [ ] **Step 7: Run frontend tests, lint, build**

Run: `pnpm vitest run src/features/nl-query src/features/auth && pnpm lint && pnpm build`
Expected: all green.

- [ ] **Step 8: Manual browser check** (start backend `pnpm start:dev`, frontend `pnpm dev`; the upstream text-to-SQL service must be reachable, otherwise seed a conversation via `psql`): ask a question → URL gains the id and the sidebar lists it; refresh → chat reloads with table/chart; ask a follow-up ("ต่อ") → still one conversation; rename; delete the open one → empty state; narrow the window → "ประวัติ" opens the sheet; open `/nl-query/00000000-0000-0000-0000-000000000000` → error alert and redirect to `/nl-query`.

- [ ] **Step 9: Commit (in sts-frontend)**

```bash
git add src/features/nl-query src/app/router.tsx
git commit -m "feat(nl-query): chat history sidebar and deep links"
```

---

## Self-Review

- **Coverage of agreed design:** tables + audit link (T1); ownership/404, server-derived history, error-turn skipping, lock for `seq` (T2); five endpoints, `conversation_id` in response, legacy `history` ignored, no-orphan-conversation on 502 (T3); `conversationId` payload, `load`, stale guards (T4); sidebar/rename/delete/deep-link/mobile sheet (T5). Retention and search are explicitly excluded in Global Constraints.
- **Placeholder scan:** Task 3 Steps 1/3 and Task 5 Steps 1/5 describe test cases in prose (with exact assertions listed) instead of full code, because they extend existing spec files whose helpers must be read in place; the implementer must write them following the neighbouring tests. Everything else carries code.
- **Type consistency:** `PriorTurnPayload` (T2) feeds the upstream body mapping in T3; `NlQueryResponse` (T3) = frontend `NlQueryResponse` (T4); `ConversationSummary/Detail` snake_case fields match between `NlConversationService` and the frontend types; `load(id): Promise<boolean>` is what T5 awaits.
- **Known risks to verify during execution:** `gen_random_uuid()` availability (T1 Step 7); `bootstrap:verify-parity` may require registering the new tables in the bootstrap SQL (T1 Step 8); `pnpm lint` auto-fixes files, review its diff; React Router optional-segment behavior (T5 Step 6); the two repos are committed separately.
