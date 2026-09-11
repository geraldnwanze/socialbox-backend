import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { WorkspaceMember } from '../../workspaces/entities/workspace-member.entity';
import { MessageAttachment } from './message-attachment.entity';
import {
  MessageDirection,
  MessageStatus,
  MessageType,
  SenderType,
} from '../enums/message.enums';

@Entity('messages')
@Index(['conversationId', 'createdAt'])
// Idempotency: a given channel connection can never report the same external message twice.
// Partial (NULLS not distinct is unnecessary here — Postgres treats NULLs as distinct by
// default, which is exactly what we want: many not-yet-sent outbound messages may have a NULL
// external id simultaneously).
@Index(['channelConnectionId', 'externalMessageId'], { unique: true })
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  workspaceId: string;

  @Column('uuid')
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column('uuid')
  channelConnectionId: string;

  /** The provider's id for this message. Null until an outbound send confirms one. */
  @Column({ nullable: true })
  externalMessageId?: string;

  @Column({ type: 'enum', enum: SenderType })
  senderType: SenderType;

  /** Platform-level sender id (contact's external id on inbound messages). */
  @Column({ nullable: true })
  senderExternalId?: string;

  /** Set when senderType is AGENT: which workspace member sent this. */
  @Column({ nullable: true })
  senderMemberId?: string;

  @ManyToOne(() => WorkspaceMember, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'sender_member_id' })
  senderMember?: WorkspaceMember;

  @Column({ type: 'enum', enum: MessageDirection })
  direction: MessageDirection;

  @Column({ type: 'enum', enum: MessageType, default: MessageType.TEXT })
  messageType: MessageType;

  @Column({ type: 'text', nullable: true })
  content?: string;

  @Column({ type: 'enum', enum: MessageStatus })
  status: MessageStatus;

  @Column({ nullable: true })
  failureReason?: string;

  @Column({ type: 'timestamptz' })
  sentAt: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @OneToMany(() => MessageAttachment, (attachment) => attachment.message)
  attachments: MessageAttachment[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
