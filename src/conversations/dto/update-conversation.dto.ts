import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateConversationDto {
  @IsOptional()
  @IsBoolean()
  read?: boolean;
}
