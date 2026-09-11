export enum WorkspaceRole {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  AGENT = 'AGENT',
}

/** Roles at or above the given role, used for "minimum role required" checks. */
export const ROLE_HIERARCHY: Record<WorkspaceRole, number> = {
  [WorkspaceRole.AGENT]: 0,
  [WorkspaceRole.ADMIN]: 1,
  [WorkspaceRole.OWNER]: 2,
};

export function hasMinimumRole(
  actual: WorkspaceRole,
  required: WorkspaceRole,
): boolean {
  return ROLE_HIERARCHY[actual] >= ROLE_HIERARCHY[required];
}
