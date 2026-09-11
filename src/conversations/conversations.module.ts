import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from './entities/conversation.entity';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { ConversationAssignment } from './entities/conversation-assignment.entity';
import { ContactIdentity } from '../contacts/entities/contact-identity.entity';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { ConversationsService } from './conversations.service';
import { ConversationsController } from './conversations.controller';
import { MessagesModule } from '../messages/messages.module';
import { TagsModule } from '../tags/tags.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AccessControlModule } from '../common/access-control/access-control.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      ConversationParticipant,
      ConversationAssignment,
      ContactIdentity,
      WorkspaceMember,
    ]),
    forwardRef(() => MessagesModule),
    TagsModule,
    RealtimeModule,
    NotificationsModule,
    AccessControlModule,
  ],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
