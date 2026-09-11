import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { WorkspaceRole } from '../enums/workspace-role.enum';

export interface WorkspaceContext {
  workspaceId: string;
  role: WorkspaceRole;
  workspaceMemberId: string;
}

export const CurrentWorkspace = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): WorkspaceContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.workspaceContext;
  },
);
