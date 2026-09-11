import { Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.notificationsService.listForUser(
      workspace.workspaceId,
      user.id,
    );
  }

  @Patch(':id/read')
  async markRead(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.notificationsService.markRead(
      workspace.workspaceId,
      user.id,
      id,
    );
    return { status: 'ok' };
  }

  @Patch('read-all')
  async markAllRead(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.notificationsService.markAllRead(workspace.workspaceId, user.id);
    return { status: 'ok' };
  }
}
