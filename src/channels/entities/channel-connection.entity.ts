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
import {
  ChannelConnectionStatus,
  ChannelType,
} from '../enums/channel-type.enum';

@Entity('channel_connections')
@Index(['workspaceId', 'type'])
export class ChannelConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  workspaceId: string;

  @ManyToOne(() => Workspace, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspace_id' })
  workspace: Workspace;

  @Column({ type: 'enum', enum: ChannelType })
  type: ChannelType;

  /** Which concrete adapter/provider implements this connection, e.g. "whatsapp-cloud-api". */
  @Column()
  provider: string;

  @Column({
    type: 'enum',
    enum: ChannelConnectionStatus,
    default: ChannelConnectionStatus.PENDING,
  })
  status: ChannelConnectionStatus;

  @Column({ nullable: true })
  externalAccountId?: string;

  @Column({ nullable: true })
  externalAccountName?: string;

  /**
   * Encrypted JSON blob (AES-256-GCM, see EncryptionService) containing access/refresh tokens
   * and any other provider secrets. Never selected by default and never serialized to clients.
   */
  @Column({ type: 'text', nullable: true, select: false })
  encryptedCredentials?: string;

  @Column({ type: 'timestamptz', nullable: true })
  tokenExpiresAt?: Date;

  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, unknown>;

  @Column({ nullable: true })
  lastErrorMessage?: string;

  /**
   * Decrypted credentials (bot token / access token / ...), populated in-memory by
   * ChannelsService right before an adapter call. Not a database column — never persisted,
   * never included in JSON responses.
   */
  credentials?: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
