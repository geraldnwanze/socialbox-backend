import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import { WorkspacesService } from './workspaces.service';
import { UpdateWorkspaceSettingsDto } from './dto/update-workspace-settings.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { WorkspaceRolesGuard } from '../common/guards/workspace-roles.guard';
import { RequireRole } from '../common/decorators/roles.decorator';
import { WorkspaceRole } from '../common/enums/workspace-role.enum';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';

@Controller('workspace/settings')
@UseGuards(JwtAuthGuard, WorkspaceGuard, WorkspaceRolesGuard)
export class WorkspaceSettingsController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @RequireRole(WorkspaceRole.ADMIN)
  @Patch()
  update(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Body() dto: UpdateWorkspaceSettingsDto,
  ) {
    return this.workspacesService.updateSettings(workspace.workspaceId, dto);
  }
}
