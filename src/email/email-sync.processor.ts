import { Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QueueName } from '../queue/queue.constants';
import { EmailSyncService } from './email-sync.service';

const SCHEDULER_ID = 'email-poll';

@Processor(QueueName.EMAIL_SYNC)
export class EmailSyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EmailSyncProcessor.name);

  constructor(
    @InjectQueue(QueueName.EMAIL_SYNC) private readonly queue: Queue,
    private readonly syncService: EmailSyncService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  /** One repeating job for the whole fleet: BullMQ dedupes the scheduler by id, so several worker
   *  replicas never poll the same mailboxes concurrently. */
  async onModuleInit(): Promise<void> {
    const every = Math.max(
      5_000,
      this.config.get<number>('email.pollIntervalMs') ?? 30_000,
    );
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every },
      {
        name: 'poll',
        opts: { attempts: 1, removeOnComplete: 10, removeOnFail: 50 },
      },
    );
    this.logger.log(`Polling email mailboxes every ${every / 1000}s`);
  }

  async process(): Promise<void> {
    await this.syncService.syncAll();
  }
}
