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
