import { SetMetadata } from '@nestjs/common';
import { WorkspaceRole } from '../enums/workspace-role.enum';

export const MINIMUM_ROLE_KEY = 'minimumRole';

/** Requires the caller's workspace membership role to be at or above `role`. */
export const RequireRole = (role: WorkspaceRole) =>
  SetMetadata(MINIMUM_ROLE_KEY, role);
