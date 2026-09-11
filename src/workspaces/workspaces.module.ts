import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceMember } from './entities/workspace-member.entity';
import { WorkspacesService } from './workspaces.service';
import { WorkspacesController } from './workspaces.controller';
import { WorkspaceMembersController } from './workspace-members.controller';
import { UsersModule } from '../users/users.module';
import { AccessControlModule } from '../common/access-control/access-control.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Workspace, WorkspaceMember]),
    UsersModule,
    AccessControlModule,
  ],
  controllers: [WorkspacesController, WorkspaceMembersController],
  providers: [WorkspacesService],
  exports: [WorkspacesService],
})
export class WorkspacesModule {}
