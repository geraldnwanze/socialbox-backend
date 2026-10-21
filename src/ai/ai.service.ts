import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import type { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { AiClient } from './ai.client';
import {
  ConversationSummary,
  RewriteTone,
  SUMMARY_SYSTEM,
  TranscriptLine,
  formatTranscript,
  parseSummary,
  rewriteSystem,
  suggestReplySystem,
} from './ai.prompts';
import { redactSensitive } from './ai.redact';
import { ConversationsService } from '../conversations/conversations.service';
import { Message } from '../messages/entities/message.entity';
import { MessageDirection, SenderType } from '../messages/enums/message.enums';
import { User } from '../users/entities/user.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { CannedResponse } from '../canned-responses/entities/canned-response.entity';
import { REDIS_CLIENT } from '../redis/redis.module';
import { AppException } from '../common/exceptions/app.exception';

const HISTORY_MESSAGES = 30;
const REFERENCE_REPLIES = 15;
const SUMMARY_CACHE_SECONDS = 24 * 60 * 60;

@Injectable()
export class AiService {
  constructor(
    private readonly ai: AiClient,
    private readonly config: ConfigService,
    private readonly conversations: ConversationsService,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    @InjectRepository(CannedResponse)
    private readonly replies: Repository<CannedResponse>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async status(workspaceId: string) {
    const workspace = await this.workspaces.findOne({
      where: { id: workspaceId },
      select: { id: true, aiAssistEnabled: true },
    });
    return {
      configured: this.ai.isConfigured(),
      enabled: !!workspace?.aiAssistEnabled,
    };
  }

  /**
   * Gate for every AI call: the server has a key, an admin switched it on for this workspace (it
   * sends conversation text to Anthropic, so it is opt-in), and the workspace is under its daily cap.
   */
  private async admit(workspaceId: string): Promise<Workspace> {
    if (!this.ai.isConfigured()) {
      throw new AppException(
        'AI_NOT_CONFIGURED',
        'AI assist is not set up on this server',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const workspace = await this.workspaces.findOne({
      where: { id: workspaceId },
    });
    if (!workspace?.aiAssistEnabled) {
      throw new AppException(
        'AI_DISABLED',
        'AI assist is switched off for this workspace — an admin can turn it on in Settings → Workspace',
        HttpStatus.FORBIDDEN,
      );
    }
    const key = `ai:daily:${workspaceId}:${new Date().toISOString().slice(0, 10)}`;
    const used = await this.redis.incr(key);
    if (used === 1) await this.redis.expire(key, 2 * 24 * 60 * 60);
    const limit = this.config.get<number>('ai.dailyLimitPerWorkspace') ?? 500;
    if (used > limit) {
      throw new AppException(
        'AI_LIMIT',
        "This workspace has reached today's AI assist limit",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return workspace;
  }

  private async transcript(
    conversationId: string,
  ): Promise<{ lines: TranscriptLine[]; lastMessageId: string | null }> {
    const rows = await this.messages.find({
      where: { conversationId },
      order: { sentAt: 'DESC' },
      take: HISTORY_MESSAGES,
    });
    rows.reverse();
    const lines = rows.map((m): TranscriptLine => {
      const from =
        m.direction === MessageDirection.INBOUND
          ? 'Customer'
          : m.senderType === SenderType.SYSTEM
            ? 'Automated reply'
            : 'Agent';
      const subject =
        typeof m.metadata?.subject === 'string'
          ? m.metadata.subject
          : undefined;
      return {
        from,
        text: m.content?.trim() || `[${m.messageType.toLowerCase()}]`,
        subject: from === 'Customer' ? subject : undefined,
      };
    });
    return { lines, lastMessageId: rows.at(-1)?.id ?? null };
  }

  async summarize(
    workspaceId: string,
    conversationId: string,
  ): Promise<ConversationSummary & { cached: boolean }> {
    await this.conversations.findOneForWorkspace(workspaceId, conversationId); // tenancy
    const { lines, lastMessageId } = await this.transcript(conversationId);
    if (lines.length === 0) {
      throw new AppException(
        'AI_NOTHING_TO_SUMMARIZE',
        'There are no messages to summarize yet',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Same conversation state, same answer: reopening the panel costs nothing.
    const cacheKey = `ai:summary:${conversationId}:${lastMessageId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached)
      return { ...(JSON.parse(cached) as ConversationSummary), cached: true };

    await this.admit(workspaceId);
    const raw = await this.ai.complete({
      system: SUMMARY_SYSTEM,
      user: `<conversation>\n${formatTranscript(lines)}\n</conversation>`,
      maxTokens: 500,
    });
    const parsed = parseSummary(raw);
    if (!parsed) {
      throw new AppException(
        'AI_FAILED',
        "AI assist couldn't summarize this one — try again",
        HttpStatus.BAD_GATEWAY,
      );
    }
    await this.redis.set(
      cacheKey,
      JSON.stringify(parsed),
      'EX',
      SUMMARY_CACHE_SECONDS,
    );
    return { ...parsed, cached: false };
  }

  async suggestReply(
    workspaceId: string,
    conversationId: string,
    userId: string,
    instruction?: string,
  ): Promise<{ text: string }> {
    const conversation = await this.conversations.findOneForWorkspace(
      workspaceId,
      conversationId,
    );
    const { lines } = await this.transcript(conversationId);
    if (!lines.some((l) => l.from === 'Customer')) {
      throw new AppException(
        'AI_NOTHING_TO_REPLY_TO',
        "There's no customer message to reply to yet",
        HttpStatus.BAD_REQUEST,
      );
    }
    const workspace = await this.admit(workspaceId);

    const [user, replies] = await Promise.all([
      this.users.findOne({
        where: { id: userId },
        select: { id: true, fullName: true },
      }),
      this.replies.find({
        where: { workspaceId },
        order: { title: 'ASC' },
        take: REFERENCE_REPLIES,
      }),
    ]);
    const agentName = user?.fullName.split(/\s+/)[0] ?? 'the agent';
    const steer = instruction?.trim()
      ? `\n\nThe agent's guidance for this reply: ${instruction.trim()}`
      : '';

    const text = (
      await this.ai.complete({
        system: suggestReplySystem({
          agentName,
          workspaceName: workspace.name,
          channel:
            conversation.channelConnection?.type ?? ('LIVE_CHAT' as never),
          referenceReplies: replies.map((r) => ({
            title: r.title,
            content: r.content.slice(0, 500),
          })),
        }),
        user: `<conversation>\n${formatTranscript(lines)}\n</conversation>${steer}\n\nWrite the reply now.`,
        maxTokens: 700,
      })
    ).trim();
    if (!text)
      throw new AppException(
        'AI_FAILED',
        "AI assist couldn't write a draft — try again",
        HttpStatus.BAD_GATEWAY,
      );
    return { text: text.slice(0, 4000) };
  }

  async rewrite(
    workspaceId: string,
    text: string,
    tone: RewriteTone,
  ): Promise<{ text: string }> {
    await this.admit(workspaceId);
    const rewritten = (
      await this.ai.complete({
        system: rewriteSystem(tone),
        user: redactSensitive(text),
        maxTokens: 1000,
      })
    ).trim();
    if (!rewritten)
      throw new AppException(
        'AI_FAILED',
        "AI assist couldn't rewrite that — try again",
        HttpStatus.BAD_GATEWAY,
      );
    return { text: rewritten.slice(0, 4000) };
  }
}
