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
import { Contact } from './contact.entity';
import { ChannelConnection } from '../../channels/entities/channel-connection.entity';
import { ChannelType } from '../../channels/enums/channel-type.enum';

/**
 * One identity a contact is known by on a specific channel connection. A contact may have
 * several (e.g. the same person on WhatsApp and Instagram) but they are only linked when a
 * business deliberately merges them — matching is never done automatically on weak signals.
 */
@Entity('contact_identities')
@Index(['channelConnectionId', 'externalUserId'], { unique: true })
export class ContactIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  contactId: string;

  @ManyToOne(() => Contact, (contact) => contact.identities, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'contact_id' })
  contact: Contact;

  @Column('uuid')
  workspaceId: string;

  @Column({ type: 'enum', enum: ChannelType })
  channel: ChannelType;

  @Column()
  channelConnectionId: string;

  @ManyToOne(() => ChannelConnection, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'channel_connection_id' })
  channelConnection: ChannelConnection;

  /** The platform's stable identifier for this person on this channel (phone/PSID/chat id/...). */
  @Column()
  externalUserId: string;

  @Column({ nullable: true })
  username?: string;

  @Column({ nullable: true })
  displayName?: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
