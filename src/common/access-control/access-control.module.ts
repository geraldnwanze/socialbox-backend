import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkspaceMember } from '../../workspaces/entities/workspace-member.entity';
import { WorkspaceGuard } from '../guards/workspace.guard';
import { WorkspaceRolesGuard } from '../guards/workspace-roles.guard';

/**
 * Provides the guards every tenant-scoped feature module needs (workspace membership
 * resolution + minimum-role checks). Imported explicitly by each feature module rather than
 * made global, so it's obvious from a module's imports which of its routes are tenant-scoped.
 */
@Module({
  imports: [TypeOrmModule.forFeature([WorkspaceMember])],
  providers: [WorkspaceGuard, WorkspaceRolesGuard],
  exports: [WorkspaceGuard, WorkspaceRolesGuard, TypeOrmModule],
})
export class AccessControlModule {}
