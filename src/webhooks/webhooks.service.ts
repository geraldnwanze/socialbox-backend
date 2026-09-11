import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { WebhookEvent } from './entities/webhook-event.entity';
import { QueueName, WebhookJobName } from '../queue/queue.constants';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookEvents: Repository<WebhookEvent>,
    @InjectQueue(QueueName.WEBHOOKS) private readonly webhooksQueue: Queue,
  ) {}

  /**
   * Records each atomic event in a webhook delivery and enqueues processing only for events
   * never seen before — the `INSERT ... ON CONFLICT DO NOTHING` is the idempotency boundary:
   * a provider retrying the exact same delivery five times results in at most one queued job
   * per event key.
   */
  async ingest(
    provider: string,
    channelConnectionId: string,
    rawPayload: unknown,
    eventKeys: string[],
  ): Promise<void> {
    for (const externalEventId of eventKeys) {
      const result = await this.webhookEvents
        .createQueryBuilder()
        .insert()
        .into(WebhookEvent)
        .values({
          provider,
          channelConnectionId,
          externalEventId,
          rawPayload: rawPayload as object,
        })
        .orIgnore()
        .returning('id')
        .execute();

      const insertedId: string | undefined = result.raw?.[0]?.id;
      if (!insertedId) {
        this.logger.debug(
          `Duplicate webhook delivery ignored: ${provider}/${externalEventId}`,
        );
        continue;
      }

      await this.webhooksQueue.add(WebhookJobName.PROCESS_EVENT, {
        webhookEventId: insertedId,
      });
    }
  }
}
