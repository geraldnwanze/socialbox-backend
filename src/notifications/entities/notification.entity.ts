import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum NotificationType {
  CONVERSATION_ASSIGNED = 'CONVERSATION_ASSIGNED',
}

/** Lightweight in-app notifications (e.g. "you were assigned a conversation"). */
@Entity('notifications')
@Index(['workspaceId', 'userId', 'readAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  workspaceId: string;

  @Column('uuid')
  userId: string;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column({ type: 'jsonb', default: {} })
  payload: Record<string, unknown>;

  @Column({ type: 'timestamptz', nullable: true })
  readAt?: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
