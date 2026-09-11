import { IsEmail, IsEnum } from 'class-validator';
import { WorkspaceRole } from '../../common/enums/workspace-role.enum';

export class AddMemberDto {
  @IsEmail()
  email: string;

  @IsEnum(WorkspaceRole)
  role: WorkspaceRole;
}

export class UpdateMemberDto {
  @IsEnum(WorkspaceRole)
  role: WorkspaceRole;
}
