import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AiService } from './ai.service';
import { RewriteDto, SuggestReplyDto } from './dto/ai.dto';
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

@Controller('ai')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  /** Lets the UI decide whether to show AI buttons at all. */
  @Get('status')
  status(@CurrentWorkspace() workspace: WorkspaceContext) {
    return this.ai.status(workspace.workspaceId);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('conversations/:id/summary')
  @HttpCode(200)
  summary(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.ai.summarize(workspace.workspaceId, id);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('conversations/:id/suggest-reply')
  @HttpCode(200)
  suggestReply(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuggestReplyDto,
  ) {
    return this.ai.suggestReply(
      workspace.workspaceId,
      id,
      user.id,
      dto.instruction,
    );
  }

  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('rewrite')
  @HttpCode(200)
  rewrite(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Body() dto: RewriteDto,
  ) {
    return this.ai.rewrite(workspace.workspaceId, dto.text, dto.tone);
  }
}
