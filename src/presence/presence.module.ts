import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '../conversations/entities/conversation.entity';
import { User } from '../users/entities/user.entity';
import { RealtimeModule } from '../realtime/realtime.module';
import { AccessControlModule } from '../common/access-control/access-control.module';
import { PresenceService } from './presence.service';
import { PresenceController } from './presence.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Conversation, User]),
    RealtimeModule,
    AccessControlModule,
  ],
  controllers: [PresenceController],
  providers: [PresenceService],
})
export class PresenceModule {}
