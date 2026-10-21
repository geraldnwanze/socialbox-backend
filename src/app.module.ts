import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { QueueModule } from './queue/queue.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { ChannelsModule } from './channels/channels.module';
import { ContactsModule } from './contacts/contacts.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { TagsModule } from './tags/tags.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { RealtimeModule } from './realtime/realtime.module';
import { HealthModule } from './health/health.module';
import { WidgetModule } from './widget/widget.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { PresenceModule } from './presence/presence.module';
import { AutomationModule } from './automation/automation.module';
import { InboxViewsModule } from './inbox-views/inbox-views.module';
import { CannedResponsesModule } from './canned-responses/canned-responses.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 120 }] }),
    DatabaseModule.forRoot({ runMigrations: true }),
    RedisModule,
    QueueModule,
    HealthModule,
    AuthModule,
    UsersModule,
    WorkspacesModule,
    ChannelsModule,
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    TagsModule,
    WebhooksModule,
    NotificationsModule,
    AttachmentsModule,
    RealtimeModule,
    WidgetModule,
    CannedResponsesModule,
    AnalyticsModule,
    PresenceModule,
    AutomationModule,
    InboxViewsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
