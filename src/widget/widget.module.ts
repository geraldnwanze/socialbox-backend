import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelConnection } from '../channels/entities/channel-connection.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Message } from '../messages/entities/message.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { StorageModule } from '../storage/storage.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WidgetController } from './widget.controller';
import { WidgetService } from './widget.service';
import { VisitorInfoService } from './visitor-info';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([
      ChannelConnection,
      Conversation,
      Message,
      Workspace,
    ]),
    WebhooksModule,
    StorageModule,
    RealtimeModule,
  ],
  controllers: [WidgetController],
  providers: [WidgetService, VisitorInfoService],
})
export class WidgetModule {}
