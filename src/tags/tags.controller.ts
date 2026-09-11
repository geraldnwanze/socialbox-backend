import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { TagsService } from './tags.service';
import { CreateTagDto, UpdateTagDto } from './dto/tag.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { WorkspaceRolesGuard } from '../common/guards/workspace-roles.guard';
import { RequireRole } from '../common/decorators/roles.decorator';
import { WorkspaceRole } from '../common/enums/workspace-role.enum';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';

@Controller('tags')
@UseGuards(JwtAuthGuard, WorkspaceGuard, WorkspaceRolesGuard)
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  list(@CurrentWorkspace() workspace: WorkspaceContext) {
    return this.tagsService.list(workspace.workspaceId);
  }

  @RequireRole(WorkspaceRole.ADMIN)
  @Post()
  create(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Body() dto: CreateTagDto,
  ) {
    return this.tagsService.create(workspace.workspaceId, dto.name, dto.color);
  }

  @RequireRole(WorkspaceRole.ADMIN)
  @Patch(':id')
  update(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
    @Body() dto: UpdateTagDto,
  ) {
    return this.tagsService.update(workspace.workspaceId, id, dto);
  }

  @RequireRole(WorkspaceRole.ADMIN)
  @Delete(':id')
  async remove(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
  ) {
    await this.tagsService.remove(workspace.workspaceId, id);
    return { status: 'ok' };
  }
}
