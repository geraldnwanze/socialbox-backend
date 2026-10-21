import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { WebhookEvent } from './entities/webhook-event.entity';
import { WebhooksService } from './webhooks.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { MetaWebhookController } from './meta-webhook.controller';
import { QueueName } from '../queue/queue.constants';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookEvent]),
    BullModule.registerQueue({ name: QueueName.WEBHOOKS }),
    ChannelsModule,
  ],
  controllers: [
    TelegramWebhookController,
    WhatsAppWebhookController,
    MetaWebhookController,
  ],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
