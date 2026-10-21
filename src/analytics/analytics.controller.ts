import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { OverviewQueryDto } from './dto/overview-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { WorkspaceRolesGuard } from '../common/guards/workspace-roles.guard';
import { RequireRole } from '../common/decorators/roles.decorator';
import { WorkspaceRole } from '../common/enums/workspace-role.enum';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';

@Controller('analytics')
@UseGuards(JwtAuthGuard, WorkspaceGuard, WorkspaceRolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /** Team-wide performance (includes per-agent figures), so admins and owners only. */
  @Get('overview')
  @RequireRole(WorkspaceRole.ADMIN)
  overview(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Query() query: OverviewQueryDto,
  ) {
    return this.analyticsService.overview(
      workspace.workspaceId,
      query.days ?? 7,
    );
  }
}
