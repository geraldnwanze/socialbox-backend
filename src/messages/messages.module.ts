import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Message } from './entities/message.entity';
import { MessageAttachment } from './entities/message-attachment.entity';
import { MessagesService } from './messages.service';
import { MessagesController } from './messages.controller';
import { QueueName } from '../queue/queue.constants';
import { ConversationsModule } from '../conversations/conversations.module';
import { AccessControlModule } from '../common/access-control/access-control.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, MessageAttachment]),
    BullModule.registerQueue(
      { name: QueueName.OUTBOUND_MESSAGES },
      { name: QueueName.MEDIA },
    ),
    forwardRef(() => ConversationsModule),
    AccessControlModule,
    RealtimeModule,
  ],
  controllers: [MessagesController],
  providers: [MessagesService],
  exports: [MessagesService],
})
export class MessagesModule {}
