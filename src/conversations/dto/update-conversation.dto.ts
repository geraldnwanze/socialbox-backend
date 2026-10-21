import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { ConversationPriority } from '../enums/conversation-priority.enum';

export class UpdateConversationDto {
  @IsOptional()
  @IsBoolean()
  read?: boolean;

  @IsOptional()
  @IsEnum(ConversationPriority)
  priority?: ConversationPriority;
}
