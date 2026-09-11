import { IsObject } from 'class-validator';

export class ConnectChannelDto {
  /** Provider-specific credentials — shape depends on the :type route param (see each adapter's connect()). */
  @IsObject()
  credentials: Record<string, unknown>;
}
