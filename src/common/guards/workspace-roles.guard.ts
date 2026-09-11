import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MINIMUM_ROLE_KEY } from '../decorators/roles.decorator';
import { hasMinimumRole, WorkspaceRole } from '../enums/workspace-role.enum';
import { InsufficientRoleException } from '../exceptions/app.exception';

/** Must run after WorkspaceGuard, which populates request.workspaceContext. */
@Injectable()
export class WorkspaceRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRole = this.reflector.getAllAndOverride<
      WorkspaceRole | undefined
    >(MINIMUM_ROLE_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredRole) return true;

    const request = context.switchToHttp().getRequest();
    const role: WorkspaceRole | undefined = request.workspaceContext?.role;
    if (!role || !hasMinimumRole(role, requiredRole)) {
      throw new InsufficientRoleException();
    }
    return true;
  }
}
