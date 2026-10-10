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
