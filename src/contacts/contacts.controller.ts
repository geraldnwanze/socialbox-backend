import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ListContactsDto } from './dto/list-contacts.dto';
import { MergeContactDto, UpdateContactDto } from './dto/update-contact.dto';
import { WorkspaceRolesGuard } from '../common/guards/workspace-roles.guard';
import { RequireRole } from '../common/decorators/roles.decorator';
import { WorkspaceRole } from '../common/enums/workspace-role.enum';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';

@Controller('contacts')
@UseGuards(JwtAuthGuard, WorkspaceGuard, WorkspaceRolesGuard)
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Get()
  list(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Query() query: ListContactsDto,
  ) {
    return this.contactsService.list(workspace.workspaceId, query);
  }

  @Get(':id')
  getOne(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contactsService.findOneForWorkspace(workspace.workspaceId, id);
  }

  @Patch(':id')
  update(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateContactDto,
  ) {
    return this.contactsService.update(workspace.workspaceId, id, dto);
  }

  @Get(':id/conversations')
  conversations(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.contactsService.listConversations(workspace.workspaceId, id);
  }

  @Post(':id/merge')
  @RequireRole(WorkspaceRole.ADMIN)
  merge(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MergeContactDto,
  ) {
    return this.contactsService.merge(
      workspace.workspaceId,
      id,
      dto.sourceContactId,
    );
  }
}
