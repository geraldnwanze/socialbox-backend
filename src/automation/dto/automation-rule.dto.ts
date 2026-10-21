import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Keep the raw arrays: the app's global pipe converts values implicitly, and for an `unknown[]`
 * that would turn every item into `[]`. conditions/actions are validated in depth by
 * automation.validation.ts (readable messages).
 */
const raw = ({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
  obj[key];
export class CreateAutomationRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @Transform(raw)
  @IsArray()
  conditions: unknown[];

  @Transform(raw)
  @IsArray()
  actions: unknown[];
}

export class UpdateAutomationRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @Transform(raw)
  @IsArray()
  conditions?: unknown[];

  @IsOptional()
  @Transform(raw)
  @IsArray()
  actions?: unknown[];
}
