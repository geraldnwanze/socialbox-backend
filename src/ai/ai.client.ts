import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { AppException } from '../common/exceptions/app.exception';

/**
 * The only place that talks to Anthropic. Everything else asks for "a completion" and gets text or
 * a clean, user-presentable error — provider details and the API key never leak outward.
 */
@Injectable()
export class AiClient {
  private readonly logger = new Logger(AiClient.name);
  private client?: Anthropic;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return !!this.config.get<string>('ai.apiKey');
  }

  get model(): string {
    return this.config.get<string>('ai.model') ?? 'claude-sonnet-5-5';
  }

  async complete(input: {
    system: string;
    user: string;
    maxTokens: number;
  }): Promise<string> {
    const apiKey = this.config.get<string>('ai.apiKey');
    if (!apiKey) {
      throw new AppException(
        'AI_NOT_CONFIGURED',
        'AI assist is not set up on this server',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    this.client ??= new Anthropic({ apiKey, timeout: 45_000, maxRetries: 1 });

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: input.maxTokens,
        system: input.system,
        messages: [{ role: 'user', content: input.user }],
      });
      if (response.stop_reason === 'refusal') {
        throw new AppException(
          'AI_DECLINED',
          'The AI declined to work on this conversation — write this one yourself',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      return response.content
        .map((block) => (block.type === 'text' ? block.text : ''))
        .join('')
        .trim();
    } catch (error) {
      if (error instanceof AppException) throw error;
      const status = (error as { status?: number }).status;
      this.logger.warn(
        `Anthropic request failed (${status ?? 'network'}): ${(error as Error).message}`,
      );
      if (status === 401 || status === 403) {
        throw new AppException(
          'AI_PROVIDER_REJECTED',
          "The server's AI key was rejected — ask an administrator to check it",
          HttpStatus.BAD_GATEWAY,
        );
      }
      if (status === 429 || status === 529) {
        throw new AppException(
          'AI_BUSY',
          'The AI service is busy right now — try again in a moment',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      throw new AppException(
        'AI_FAILED',
        "AI assist couldn't complete that — try again",
        HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
