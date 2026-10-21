import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiClient } from './ai.client';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { ConversationsModule } from '../conversations/conversations.module';
import { Message } from '../messages/entities/message.entity';
import { User } from '../users/entities/user.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { CannedResponse } from '../canned-responses/entities/canned-response.entity';
import { AccessControlModule } from '../common/access-control/access-control.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, User, Workspace, CannedResponse]),
    ConversationsModule,
    AccessControlModule,
  ],
  controllers: [AiController],
  providers: [AiClient, AiService],
})
export class AiModule {}
