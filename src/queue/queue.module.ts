import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from './queue.constants';

/**
 * Registers the Redis connection and all BullMQ queues. Imported by both the API (which only
 * ever produces jobs) and the worker process (which registers processors that consume them) —
 * the queue *definitions* are shared so job payload shapes never drift between the two.
 */
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          url: configService.get<string>('redis.url'),
        },
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QueueName.WEBHOOKS },
      { name: QueueName.OUTBOUND_MESSAGES },
      { name: QueueName.MEDIA },
      { name: QueueName.NOTIFICATIONS },
      { name: QueueName.EMAIL_SYNC },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
