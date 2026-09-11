import {
  IsEnum,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MessageType } from '../enums/message.enums';

export class OutboundAttachmentDto {
  @IsString()
  storageKey: string;

  @IsString()
  mimeType: string;

  @IsOptional()
  @IsString()
  fileName?: string;
}

export class CreateMessageDto {
  @IsEnum(MessageType)
  type: MessageType;

  @ValidateIf(
    (dto: CreateMessageDto) => dto.type === MessageType.TEXT || !dto.attachment,
  )
  @IsString()
  text?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OutboundAttachmentDto)
  attachment?: OutboundAttachmentDto;
}
