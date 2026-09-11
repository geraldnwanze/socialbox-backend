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
import { ContactIdentity } from '../../contacts/entities/contact-identity.entity';

/**
 * Every identity that has participated in a conversation. For the MVP's 1:1 conversations this
 * is always exactly one contact identity, but keeping it as its own table means group/multi-party
 * threads (e.g. a Telegram group) can be added later without changing the conversation schema.
 */
@Entity('conversation_participants')
@Index(['conversationId', 'contactIdentityId'], { unique: true })
export class ConversationParticipant {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  conversationId: string;

  @ManyToOne(() => Conversation, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'conversation_id' })
  conversation: Conversation;

  @Column()
  contactIdentityId: string;

  @ManyToOne(() => ContactIdentity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'contact_identity_id' })
  contactIdentity: ContactIdentity;

  @CreateDateColumn({ type: 'timestamptz' })
  joinedAt: Date;
}
