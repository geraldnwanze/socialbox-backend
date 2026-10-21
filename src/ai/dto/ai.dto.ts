import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { REWRITE_TONES, RewriteTone } from '../ai.prompts';

export class SuggestReplyDto {
  /** Optional steer from the agent, e.g. "offer a refund". Trusted input, but kept short. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  instruction?: string;
}

export class RewriteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  text: string;

  @IsIn(REWRITE_TONES)
  tone: RewriteTone;
}
