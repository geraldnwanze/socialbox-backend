import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { MessagesService } from '../messages/messages.service';
import { TagsService } from '../tags/tags.service';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { AssignConversationDto } from './dto/assign-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { CreateMessageDto } from '../messages/dto/create-message.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';
import { PaginationQuery } from '../common/pagination/cursor-pagination';

@Controller('conversations')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly tagsService: TagsService,
  ) {}

  @Get()
  list(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Query() query: ListConversationsDto,
  ) {
    return this.conversationsService.list(
      workspace.workspaceId,
      workspace.workspaceMemberId,
      query,
    );
  }

  @Get(':id')
  getOne(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
  ) {
    return this.conversationsService.findOneForWorkspace(
      workspace.workspaceId,
      id,
    );
  }

  @Patch(':id')
  async update(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
  ) {
    if (dto.read)
      return this.conversationsService.markRead(workspace.workspaceId, id);
    return this.conversationsService.findOneForWorkspace(
      workspace.workspaceId,
      id,
    );
  }

  @Post(':id/assign')
  assign(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
    @Body() dto: AssignConversationDto,
  ) {
    return this.conversationsService.assign(
      workspace.workspaceId,
      id,
      dto.assigneeMemberId ?? null,
      workspace.workspaceMemberId,
    );
  }

  @Post(':id/typing')
  @HttpCode(204)
  async typing(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.conversationsService.agentTyping(workspace.workspaceId, id);
  }

  @Post(':id/resolve')
  resolve(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
  ) {
    return this.conversationsService.resolve(workspace.workspaceId, id);
  }

  @Post(':id/pending')
  markPending(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
  ) {
    return this.conversationsService.markPending(workspace.workspaceId, id);
  }

  @Post(':id/reopen')
  reopen(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
  ) {
    return this.conversationsService.reopen(workspace.workspaceId, id);
  }

  @Get(':id/messages')
  async listMessages(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
    @Query() query: PaginationQuery,
  ) {
    await this.conversationsService.findOneForWorkspace(
      workspace.workspaceId,
      id,
    );
    return this.messagesService.listForConversation(
      workspace.workspaceId,
      id,
      query,
    );
  }

  @Post(':id/messages')
  async sendMessage(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
    @Body() dto: CreateMessageDto,
  ) {
    const conversation = await this.conversationsService.findOneForWorkspace(
      workspace.workspaceId,
      id,
    );
    return this.messagesService.createOutbound({
      workspaceId: workspace.workspaceId,
      conversationId: conversation.id,
      channelConnectionId: conversation.channelConnectionId,
      senderMemberId: workspace.workspaceMemberId,
      type: dto.type,
      text: dto.text,
      attachment: dto.attachment,
    });
  }

  @Get(':id/tags')
  async listTags(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
  ) {
    await this.conversationsService.findOneForWorkspace(
      workspace.workspaceId,
      id,
    );
    return this.tagsService.listForConversation(id);
  }

  @Post(':id/tags/:tagId')
  async addTag(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    await this.conversationsService.findOneForWorkspace(
      workspace.workspaceId,
      id,
    );
    await this.tagsService.attachToConversation(
      workspace.workspaceId,
      id,
      tagId,
    );
    return { status: 'ok' };
  }

  @Post(':id/tags/:tagId/remove')
  async removeTag(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
    @Param('tagId') tagId: string,
  ) {
    await this.conversationsService.findOneForWorkspace(
      workspace.workspaceId,
      id,
    );
    await this.tagsService.detachFromConversation(id, tagId);
    return { status: 'ok' };
  }
}
