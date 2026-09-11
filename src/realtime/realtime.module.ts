import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

@Module({
  imports: [
    JwtModule.register({}),
    TypeOrmModule.forFeature([WorkspaceMember, Conversation]),
  ],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
