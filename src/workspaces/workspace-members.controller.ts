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
import { WorkspacesService } from './workspaces.service';
import { AddMemberDto, UpdateMemberDto } from './dto/add-member.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { WorkspaceRolesGuard } from '../common/guards/workspace-roles.guard';
import { RequireRole } from '../common/decorators/roles.decorator';
import { WorkspaceRole } from '../common/enums/workspace-role.enum';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';

@Controller('workspace/members')
@UseGuards(JwtAuthGuard, WorkspaceGuard, WorkspaceRolesGuard)
export class WorkspaceMembersController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  list(@CurrentWorkspace() workspace: WorkspaceContext) {
    return this.workspacesService.listMembers(workspace.workspaceId);
  }

  @RequireRole(WorkspaceRole.ADMIN)
  @Post()
  add(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Body() dto: AddMemberDto,
  ) {
    return this.workspacesService.addMember(
      workspace.workspaceId,
      dto.email,
      dto.role,
    );
  }

  @RequireRole(WorkspaceRole.ADMIN)
  @Patch(':id')
  updateRole(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.workspacesService.updateMemberRole(
      workspace.workspaceId,
      id,
      dto.role,
    );
  }

  @RequireRole(WorkspaceRole.ADMIN)
  @Delete(':id')
  remove(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
  ) {
    return this.workspacesService.removeMember(workspace.workspaceId, id);
  }
}
