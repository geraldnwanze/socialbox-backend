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

/** Append-only assignment history, cheap to keep for an audit trail. */
@Entity('conversation_assignments')
@Index(['conversationId'])
export class ConversationAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column({ nullable: true })
  assignedToId?: string;

  @ManyToOne(() => WorkspaceMember, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assigned_to_id' })
  assignedTo?: WorkspaceMember;

  @Column()
  assignedById: string;

  @ManyToOne(() => WorkspaceMember, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assigned_by_id' })
  assignedBy?: WorkspaceMember;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
