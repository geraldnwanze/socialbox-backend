import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkspaceMember } from '../../workspaces/entities/workspace-member.entity';
import { WorkspaceAccessDeniedException } from '../exceptions/app.exception';

/**
 * Resolves the caller's membership in the workspace named by the `X-Workspace-Id` header (or
 * `workspaceId` query param as a fallback for GET requests that can't easily set headers, e.g.
 * a browser EventSource) and attaches it as `request.workspaceContext`. This is the only place
 * a workspace id from the client is ever trusted — every service downstream reads workspaceId
 * off `request.workspaceContext`, never off a client-supplied body/param, so one workspace can
 * never reach another's data by guessing an id.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    @InjectRepository(WorkspaceMember)
    private readonly workspaceMembers: Repository<WorkspaceMember>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const workspaceId =
      (request.headers['x-workspace-id'] as string) ??
      request.query?.workspaceId;

    if (!workspaceId) {
      throw new WorkspaceAccessDeniedException();
    }

    const membership = await this.workspaceMembers.findOne({
      where: { workspaceId, userId: request.user.id },
    });

    if (!membership) {
      throw new WorkspaceAccessDeniedException();
    }

    request.workspaceContext = {
      workspaceId: membership.workspaceId,
      role: membership.role,
      workspaceMemberId: membership.id,
    };
    return true;
  }
}
