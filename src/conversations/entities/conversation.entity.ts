import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Workspace } from '../../workspaces/entities/workspace.entity';
import { ChannelConnection } from '../../channels/entities/channel-connection.entity';
import { Contact } from '../../contacts/entities/contact.entity';
import { WorkspaceMember } from '../../workspaces/entities/workspace-member.entity';
import { ConversationStatus } from '../enums/conversation-status.enum';

@Entity('conversations')
@Index(['workspaceId', 'status'])
@Index(['workspaceId', 'lastMessageAt'])
@Index(['channelConnectionId', 'externalConversationId'], { unique: true })
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column()
  channelConnectionId: string;

  @ManyToOne(() => ChannelConnection, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_connection_id' })
  channelConnection: ChannelConnection;

  @Column()
  contactId: string;

  @ManyToOne(() => Contact, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  /** The platform's identifier for this thread (chat id / PSID+page / wa_id, ...). */
  @Column()
  externalConversationId: string;

  @Column({
    type: 'enum',
    enum: ConversationStatus,
    default: ConversationStatus.OPEN,
  })
  status: ConversationStatus;

  @Column({ nullable: true })
  assignedTo?: string;

  @ManyToOne(() => WorkspaceMember, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'assigned_to' })
  assignee?: WorkspaceMember;

  @Column({ type: 'timestamptz', nullable: true })
  lastMessageAt?: Date;

  @Column({ nullable: true })
  lastMessagePreview?: string;

  @Column({ type: 'int', default: 0 })
  unreadCount: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
