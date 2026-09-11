import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ListContactsDto } from './dto/list-contacts.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';

@Controller('contacts')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
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
    @Param('id') id: string,
  ) {
    return this.contactsService.findOneForWorkspace(workspace.workspaceId, id);
  }
}
