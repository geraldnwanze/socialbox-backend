import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';

@Controller('messages')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post(':id/retry')
  retry(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
  ) {
    return this.messagesService.retryFailed(workspace.workspaceId, id);
  }
}
