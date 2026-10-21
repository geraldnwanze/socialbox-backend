import {
  IsBooleanString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ConversationStatus } from '../enums/conversation-status.enum';
import { ConversationPriority } from '../enums/conversation-priority.enum';

export class ListConversationsDto {
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @IsOptional()
  @IsUUID()
  channelConnectionId?: string;

  @IsOptional()
  @IsString()
  assignedTo?: 'me' | 'unassigned' | string;

  @IsOptional()
  @IsBooleanString()
  unreadOnly?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(ConversationPriority)
  priority?: ConversationPriority;

  @IsOptional()
  @IsUUID()
  tagId?: string;

  /** newest (default) or oldest first, by last message. */
  @IsOptional()
  @IsIn(['newest', 'oldest'])
  sort?: 'newest' | 'oldest';

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
