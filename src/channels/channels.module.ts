import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ChannelConnection } from './entities/channel-connection.entity';
import { ChannelsService } from './channels.service';
import { ChannelsController } from './channels.controller';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { CHANNEL_ADAPTER_LIST } from './channels.constants';
import { TelegramAdapter } from './adapters/telegram/telegram.adapter';
import { WhatsAppAdapter } from './adapters/whatsapp/whatsapp.adapter';
import { MessengerAdapter } from './adapters/meta/messenger.adapter';
import { InstagramAdapter } from './adapters/meta/instagram.adapter';
import { XAdapter } from './adapters/x/x.adapter';
import { LiveChatAdapter } from './adapters/live-chat/live-chat.adapter';
import { EncryptionService } from '../common/crypto/encryption.service';
import { AccessControlModule } from '../common/access-control/access-control.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChannelConnection]),
    ConfigModule,
    AccessControlModule,
  ],
  controllers: [ChannelsController],
  providers: [
    ChannelsService,
    ChannelAdapterRegistry,
    EncryptionService,
    TelegramAdapter,
    WhatsAppAdapter,
    MessengerAdapter,
    InstagramAdapter,
    XAdapter,
    LiveChatAdapter,
    {
      provide: CHANNEL_ADAPTER_LIST,
      useFactory: (
        telegram: TelegramAdapter,
        whatsapp: WhatsAppAdapter,
        messenger: MessengerAdapter,
        instagram: InstagramAdapter,
        x: XAdapter,
        liveChat: LiveChatAdapter,
      ) => [telegram, whatsapp, messenger, instagram, x, liveChat],
      inject: [
        TelegramAdapter,
        WhatsAppAdapter,
        MessengerAdapter,
        InstagramAdapter,
        XAdapter,
        LiveChatAdapter,
      ],
    },
  ],
  exports: [ChannelsService, ChannelAdapterRegistry, EncryptionService],
})
export class ChannelsModule {}
