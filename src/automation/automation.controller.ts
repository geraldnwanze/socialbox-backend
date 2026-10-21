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
import { AutomationService } from './automation.service';
import {
  CreateAutomationRuleDto,
  UpdateAutomationRuleDto,
} from './dto/automation-rule.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { WorkspaceRolesGuard } from '../common/guards/workspace-roles.guard';
import { RequireRole } from '../common/decorators/roles.decorator';
import { WorkspaceRole } from '../common/enums/workspace-role.enum';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';

/** Rules change how every customer is treated, so only admins manage them. */
@Controller('automation-rules')
@UseGuards(JwtAuthGuard, WorkspaceGuard, WorkspaceRolesGuard)
@RequireRole(WorkspaceRole.ADMIN)
export class AutomationController {
  constructor(private readonly automation: AutomationService) {}

  @Get()
  list(@CurrentWorkspace() workspace: WorkspaceContext) {
    return this.automation.list(workspace.workspaceId);
  }

  @Post()
  create(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Body() dto: CreateAutomationRuleDto,
  ) {
    return this.automation.create(workspace.workspaceId, dto);
  }

  @Patch(':id')
  update(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAutomationRuleDto,
  ) {
    return this.automation.update(workspace.workspaceId, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.automation.remove(workspace.workspaceId, id);
  }
}
