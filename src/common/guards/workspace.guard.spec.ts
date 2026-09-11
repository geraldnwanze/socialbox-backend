import { ExecutionContext } from '@nestjs/common';
import { WorkspaceGuard } from './workspace.guard';
import { WorkspaceAccessDeniedException } from '../exceptions/app.exception';
import { WorkspaceRole } from '../enums/workspace-role.enum';

function buildContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('WorkspaceGuard', () => {
  it('denies a request with no workspace id', async () => {
    const guard = new WorkspaceGuard({ findOne: jest.fn() } as any);
    const request = { headers: {}, query: {}, user: { id: 'user-1' } };

    await expect(guard.canActivate(buildContext(request))).rejects.toThrow(
      WorkspaceAccessDeniedException,
    );
  });

  it('denies a user who is not a member of the requested workspace', async () => {
    const findOne = jest.fn().mockResolvedValue(null);
    const guard = new WorkspaceGuard({ findOne } as any);
    const request = {
      headers: { 'x-workspace-id': 'workspace-b' },
      query: {},
      user: { id: 'user-a' },
    };

    await expect(guard.canActivate(buildContext(request))).rejects.toThrow(
      WorkspaceAccessDeniedException,
    );
    expect(findOne).toHaveBeenCalledWith({
      where: { workspaceId: 'workspace-b', userId: 'user-a' },
    });
  });

  it('attaches workspaceContext and allows a real member through', async () => {
    const findOne = jest.fn().mockResolvedValue({
      id: 'member-1',
      workspaceId: 'workspace-a',
      role: WorkspaceRole.ADMIN,
    });
    const guard = new WorkspaceGuard({ findOne } as any);
    const request: any = {
      headers: { 'x-workspace-id': 'workspace-a' },
      query: {},
      user: { id: 'user-a' },
    };

    const result = await guard.canActivate(buildContext(request));

    expect(result).toBe(true);
    expect(request.workspaceContext).toEqual({
      workspaceId: 'workspace-a',
      role: WorkspaceRole.ADMIN,
      workspaceMemberId: 'member-1',
    });
  });
});
