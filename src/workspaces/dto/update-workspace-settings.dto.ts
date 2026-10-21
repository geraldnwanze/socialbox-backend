import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateWorkspaceSettingsDto {
  @IsOptional()
  // Implicit conversion would turn any non-empty string (even "false") into true; keep the raw value.
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
  )
  @IsBoolean()
  sendReadReceipts?: boolean;

  @IsOptional()
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
  )
  @IsBoolean()
  aiAssistEnabled?: boolean;
}
