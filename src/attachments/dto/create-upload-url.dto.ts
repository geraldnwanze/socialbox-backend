import { IsString, MaxLength, Matches } from 'class-validator';

const ALLOWED_MIME_PREFIXES = [
  'image/',
  'video/',
  'audio/',
  'application/pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.',
  'application/vnd.oasis.opendocument.',
  'application/zip',
  'text/plain',
  'text/csv',
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
