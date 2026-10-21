import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InboxViewsService } from './inbox-views.service';
import { CreateInboxViewDto, UpdateInboxViewDto } from './dto/inbox-view.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';

const actor = (w: WorkspaceContext) => ({
  workspaceId: w.workspaceId,
  memberId: w.workspaceMemberId,
  role: w.role,
});

@Controller('inbox-views')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class InboxViewsController {
  constructor(private readonly views: InboxViewsService) {}

  @Get()
  list(@CurrentWorkspace() workspace: WorkspaceContext) {
    return this.views.list(actor(workspace));
  }

  @Post()
  create(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Body() dto: CreateInboxViewDto,
  ) {
    return this.views.create(actor(workspace), dto);
  }

  @Patch(':id')
  update(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInboxViewDto,
  ) {
    return this.views.update(actor(workspace), id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.views.remove(actor(workspace), id);
  }
}
