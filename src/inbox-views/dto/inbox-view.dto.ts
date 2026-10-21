import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// The global pipe converts values implicitly; keep the object as sent and validate it ourselves.
const raw = ({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
  obj[key];

export class CreateInboxViewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  @Transform(raw)
  @IsObject()
  filters: Record<string, unknown>;

  @IsOptional()
  @Transform(raw)
  @IsBoolean()
  shared?: boolean;
}

export class UpdateInboxViewDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @Transform(raw)
  @IsObject()
  filters?: Record<string, unknown>;

  @IsOptional()
  @Transform(raw)
  @IsBoolean()
  shared?: boolean;
}
