import { IsOptional, IsUUID } from 'class-validator';

export class AssignConversationDto {
  /** Workspace member id to assign to, or omit/null to unassign. */
  @IsOptional()
  @IsUUID()
  assigneeMemberId?: string | null;
}
