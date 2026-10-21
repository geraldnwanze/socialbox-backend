import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Conversation } from './conversation.entity';
import { WorkspaceMember } from '../../workspaces/entities/workspace-member.entity';

export type ConversationEventType =
  | 'CREATED'
  | 'ASSIGNED'
  | 'UNASSIGNED'
  | 'STATUS_CHANGED'
  | 'PRIORITY_CHANGED'
  | 'TAG_ADDED'
  | 'TAG_REMOVED'
  | 'NOTE';

/**
 * Append-only activity log for a conversation: who assigned it, changed its status or priority,
 * tagged it, or left an internal note. `data` holds a snapshot (names, not just ids) so the
 * history still reads correctly after a member is removed or a tag renamed.
 */
@Entity('conversation_events')
@Index(['conversationId', 'createdAt'])
export class ConversationEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  workspaceId: string;

  @Column('uuid')
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ type: 'varchar' })
  type: ConversationEventType;

  /** The agent who did it; null for things the system did (a customer message reopening it). */
  @Column({ type: 'uuid', nullable: true })
  actorMemberId?: string | null;

  @ManyToOne(() => WorkspaceMember, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'actor_member_id' })
  actorMember?: WorkspaceMember | null;

  @Column({ type: 'jsonb', default: {} })
  data: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
