import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum WebhookEventStatus {
  PENDING = 'PENDING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}

/**
 * Idempotency ledger for raw provider webhook deliveries. The controller inserts a row with
 * `INSERT ... ON CONFLICT (provider, external_event_id) DO NOTHING` before enqueueing a job —
 * if the row already existed, the delivery is a known retry and is dropped immediately. Final
 * correctness against duplicate messages is still enforced by the unique index on
 * messages(channel_connection_id, external_message_id); this table is the fast path plus an
 * audit trail of what each provider actually sent.
 */
@Entity('webhook_events')
@Index(['provider', 'externalEventId'], { unique: true })
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  provider: string;

  @Column('uuid', { nullable: true })
  channelConnectionId?: string;

  @Column()
  externalEventId: string;

  @Column({ type: 'jsonb' })
  rawPayload: unknown;

  @Column({
    type: 'enum',
    enum: WebhookEventStatus,
    default: WebhookEventStatus.PENDING,
  })
  status: WebhookEventStatus;

  @Column({ nullable: true })
  errorMessage?: string;

  @Column({ type: 'timestamptz', nullable: true })
  processedAt?: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  receivedAt: Date;
}
