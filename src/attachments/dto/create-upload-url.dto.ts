import { IsString, MaxLength, Matches } from 'class-validator';

const ALLOWED_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'application/pdf',
  'application/msword',
];

export class CreateUploadUrlDto {
  @IsString()
  @MaxLength(255)
  fileName: string;

  @IsString()
  @Matches(
    new RegExp(
      `^(${ALLOWED_MIME_PREFIXES.map((p) => p.replace('/', '\\/')).join('|')})`,
    ),
    { message: 'Unsupported file type' },
  )
  mimeType: string;
}
