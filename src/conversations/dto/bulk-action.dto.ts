import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsUUID,
} from 'class-validator';

export const MAX_BULK = 100;

// Keep the action object as sent (the global pipe's implicit conversion would mangle it) and
// validate it in BulkConversationsService, where the messages can be readable.
const raw = ({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
  obj[key];

export class BulkActionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK)
  @IsUUID('all', { each: true })
  ids: string[];

  @Transform(raw)
  @IsObject()
  action: Record<string, unknown>;
}
