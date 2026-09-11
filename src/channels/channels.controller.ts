import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ChannelsService } from './channels.service';
import { ChannelType } from './enums/channel-type.enum';
import { ConnectChannelDto } from './dto/connect-channel.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import { WorkspaceRolesGuard } from '../common/guards/workspace-roles.guard';
import { RequireRole } from '../common/decorators/roles.decorator';
import { WorkspaceRole } from '../common/enums/workspace-role.enum';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';

@Controller('channels')
@UseGuards(JwtAuthGuard, WorkspaceGuard, WorkspaceRolesGuard)
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  async list(@CurrentWorkspace() workspace: WorkspaceContext) {
    const [connected, catalog] = await Promise.all([
      this.channelsService.listForWorkspace(workspace.workspaceId),
      this.channelsService.listChannelCatalog(),
    ]);
    return {
      connected: connected.map((c) => this.channelsService.sanitize(c)),
      catalog,
    };
  }

  @RequireRole(WorkspaceRole.ADMIN)
  @Post(':type/connect')
  connect(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('type', new ParseEnumPipe(ChannelType)) type: ChannelType,
    @Body() dto: ConnectChannelDto,
  ) {
    return this.channelsService.connect(
      workspace.workspaceId,
      type,
      dto.credentials,
    );
  }

  @Get(':id')
  async getOne(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
  ) {
    const connection = await this.channelsService.findOneForWorkspace(
      workspace.workspaceId,
      id,
    );
    return this.channelsService.sanitize(connection);
  }

  @RequireRole(WorkspaceRole.ADMIN)
  @Post(':id/reconnect')
  reconnect(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
    @Body() dto: ConnectChannelDto,
  ) {
    return this.channelsService.reconnect(
      workspace.workspaceId,
      id,
      dto.credentials,
    );
  }

  @RequireRole(WorkspaceRole.ADMIN)
  @Delete(':id')
  async remove(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
  ) {
    await this.channelsService.disconnect(workspace.workspaceId, id);
    return { status: 'ok' };
  }
}
