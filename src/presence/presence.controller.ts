import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { PresenceService } from './presence.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import {
  CurrentUser,
  AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';

class PresenceDto {
  @IsOptional()
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
  )
  @IsBoolean()
  typing?: boolean;
}

@Controller('conversations/:conversationId/presence')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post()
  async touch(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() dto: PresenceDto,
  ) {
    const viewers = await this.presence.touch(
      workspace.workspaceId,
      conversationId,
      user.id,
      dto.typing === true,
    );
    return { viewers };
  }

  @Delete()
  @HttpCode(204)
  async leave(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ) {
    await this.presence.leave(workspace.workspaceId, conversationId, user.id);
  }
}
