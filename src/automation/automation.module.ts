import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AutomationRule } from './entities/automation-rule.entity';
import { AutomationService } from './automation.service';
import { AutomationController } from './automation.controller';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { Tag } from '../tags/entities/tag.entity';
import { Conversation } from '../conversations/entities/conversation.entity';
import { ConversationsModule } from '../conversations/conversations.module';
import { MessagesModule } from '../messages/messages.module';
import { TagsModule } from '../tags/tags.module';
import { AccessControlModule } from '../common/access-control/access-control.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AutomationRule,
      WorkspaceMember,
      Tag,
      Conversation,
    ]),
    ConversationsModule,
    MessagesModule,
    TagsModule,
    AccessControlModule,
  ],
  controllers: [AutomationController],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
