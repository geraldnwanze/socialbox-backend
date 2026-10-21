import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** Empty strings clear the field, so the form can send "" to remove an email/phone/note. */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;

export class UpdateContactDto {
  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(120)
  displayName?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsEmail()
  @MaxLength(254)
  email?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(40)
  phone?: string | null;

  @IsOptional()
  @Transform(emptyToNull)
  @IsString()
  @MaxLength(5000)
  notes?: string | null;
}

export class MergeContactDto {
  /** The duplicate contact: its identities and conversations move to the contact in the URL. */
  @IsString()
  sourceContactId: string;
}
