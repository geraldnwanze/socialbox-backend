import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { ChannelsModule } from './channels/channels.module';
import { ContactsModule } from './contacts/contacts.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { StorageModule } from './storage/storage.module';
import { RealtimeModule } from './realtime/realtime.module';
import { WebhookEvent } from './webhooks/entities/webhook-event.entity';
import { Message } from './messages/entities/message.entity';
import { MessageAttachment } from './messages/entities/message-attachment.entity';
import { Conversation } from './conversations/entities/conversation.entity';
import { Notification } from './notifications/entities/notification.entity';
import { Workspace } from './workspaces/entities/workspace.entity';
import { User } from './users/entities/user.entity';
import { WebhookProcessor } from './queue/processors/webhook.processor';
import { OutboundMessageProcessor } from './queue/processors/outbound-message.processor';
import { MediaProcessor } from './queue/processors/media.processor';
import { NotificationProcessor } from './queue/processors/notification.processor';
import { WebhooksService } from './webhooks/webhooks.service';
import { EmailSyncService } from './email/email-sync.service';
import { EmailSyncProcessor } from './email/email-sync.processor';
import { EmailIdleService } from './email/email-idle.service';

/**
 * The worker process: no HTTP server, just BullMQ consumers for the four queues (webhooks,
 * outbound-messages, media, notifications). Bootstrapped separately from the API (see
 * src/worker.ts) so the two can be scaled and deployed independently, per the architecture.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    DatabaseModule.forRoot({ runMigrations: false }),
    RedisModule,
    QueueModule,
    TypeOrmModule.forFeature([
      WebhookEvent,
      Message,
      MessageAttachment,
      Conversation,
      Notification,
      Workspace,
      User,
    ]),
    ChannelsModule,
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    StorageModule,
    RealtimeModule,
  ],
  providers: [
    WebhookProcessor,
    OutboundMessageProcessor,
    MediaProcessor,
    NotificationProcessor,
    WebhooksService,
    EmailSyncService,
    EmailSyncProcessor,
    EmailIdleService,
  ],
})
export class WorkerModule {}
