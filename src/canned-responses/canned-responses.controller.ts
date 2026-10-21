import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CannedResponsesService } from './canned-responses.service';
import {
  CreateCannedResponseDto,
  UpdateCannedResponseDto,
} from './dto/canned-response.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { WorkspaceRolesGuard } from '../common/guards/workspace-roles.guard';
import { RequireRole } from '../common/decorators/roles.decorator';
import { WorkspaceRole } from '../common/enums/workspace-role.enum';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';

@Controller('canned-responses')
@UseGuards(JwtAuthGuard, WorkspaceGuard, WorkspaceRolesGuard)
export class CannedResponsesController {
  constructor(
    private readonly cannedResponsesService: CannedResponsesService,
  ) {}

  // Every member can read (agents insert them); only admins manage them.
  @Get()
  list(@CurrentWorkspace() workspace: WorkspaceContext) {
    return this.cannedResponsesService.list(workspace.workspaceId);
  }

  @RequireRole(WorkspaceRole.ADMIN)
  @Post()
  create(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Body() dto: CreateCannedResponseDto,
  ) {
    return this.cannedResponsesService.create(workspace.workspaceId, dto);
  }

  @RequireRole(WorkspaceRole.ADMIN)
  @Patch(':id')
  update(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCannedResponseDto,
  ) {
    return this.cannedResponsesService.update(workspace.workspaceId, id, dto);
  }

  @RequireRole(WorkspaceRole.ADMIN)
  @Delete(':id')
  async remove(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.cannedResponsesService.remove(workspace.workspaceId, id);
    return { status: 'ok' };
  }
}
