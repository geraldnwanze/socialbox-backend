import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Message } from './message.entity';

@Entity('message_attachments')
export class MessageAttachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  messageId: string;

  @ManyToOne(() => Message, (message) => message.attachments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'message_id' })
  message: Message;

  /** Object key in Cloudflare R2. Null while a provider-hosted media URL hasn't been mirrored yet. */
  @Column({ nullable: true })
  storageKey?: string;

  @Column({ nullable: true })
  mimeType?: string;

  @Column({ nullable: true })
  fileName?: string;

  @Column({ type: 'bigint', nullable: true })
  fileSize?: number;

  /** Provider-hosted URL (short-lived for some platforms) kept as a fallback/reference. */
  @Column({ nullable: true })
  sourceUrl?: string;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
