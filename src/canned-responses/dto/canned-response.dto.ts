import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** "/Shipping " -> "shipping": agents may type the slash or capitals; we store one canonical form. */
const normalizeShortcut = ({ value }: { value: unknown }) =>
  typeof value === 'string'
    ? value.trim().replace(/^\/+/, '').toLowerCase()
    : value;

export class CreateCannedResponseDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title: string;

  @Transform(normalizeShortcut)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{0,29}$/, {
    message:
      'Shortcut must be 1-30 characters: letters, numbers, "-" or "_" (e.g. shipping)',
  })
  shortcut: string;

  // Kept within the shortest limit among channels we ship (live chat: 2000 characters).
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}

export class UpdateCannedResponseDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @Transform(normalizeShortcut)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9_-]{0,29}$/, {
    message:
      'Shortcut must be 1-30 characters: letters, numbers, "-" or "_" (e.g. shipping)',
  })
  shortcut?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content?: string;
}
