import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InboxView } from './entities/inbox-view.entity';
import { InboxViewsService } from './inbox-views.service';
import { InboxViewsController } from './inbox-views.controller';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { ChannelConnection } from '../channels/entities/channel-connection.entity';
import { Tag } from '../tags/entities/tag.entity';
import { AccessControlModule } from '../common/access-control/access-control.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InboxView,
      WorkspaceMember,
      ChannelConnection,
      Tag,
    ]),
    AccessControlModule,
  ],
  controllers: [InboxViewsController],
  providers: [InboxViewsService],
})
export class InboxViewsModule {}
