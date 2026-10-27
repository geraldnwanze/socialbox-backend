import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { In, Repository } from 'typeorm';
import { ChannelConnection } from '../channels/entities/channel-connection.entity';
import {
  ChannelConnectionStatus,
  ChannelType,
} from '../channels/enums/channel-type.enum';
import {
  LiveChatInboundPayload,
  LiveChatWidgetConfig,
} from '../channels/adapters/live-chat/live-chat.adapter';
import { Conversation } from '../conversations/entities/conversation.entity';
import { Message } from '../messages/entities/message.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import {
  MessageDirection,
  MessageStatus,
} from '../messages/enums/message.enums';
import { WebhooksService } from '../webhooks/webhooks.service';
import { StorageService } from '../storage/storage.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RealtimeEvent } from '../realtime/realtime.events';
import { REDIS_CLIENT } from '../redis/redis.module';
import { isWithinHours } from '../channels/adapters/live-chat/live-chat-hours';
import {
  MAX_WIDGET_FILE_BYTES,
  cleanFileName,
  isAllowedWidgetFile,
} from './widget-upload';
import { VisitorInfo, sanitizePageUrl } from './visitor-info';

export interface VisitorSession {
  visitorId: string;
  connection: ChannelConnection;
}

export interface WidgetMessageView {
  id: string;
  clientId: string | null;
  direction: MessageDirection;
  content: string;
  sentAt: Date;
  attachments: { name: string; size: number | null; url: string }[];
  /** Visitor's own message that an agent has read (only when the workspace shares read receipts). */
  seen: boolean;
}

const VISITOR_TOKEN_TTL = '90d';
const MAX_MESSAGE_LENGTH = 2000;
const HISTORY_LIMIT = 100;

@Injectable()
export class WidgetService {
  constructor(
    @InjectRepository(ChannelConnection)
    private readonly connections: Repository<ChannelConnection>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly webhooksService: WebhooksService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
  ) {}

  private async findConnectedByKey(key: string): Promise<ChannelConnection> {
    const connection = await this.connections.findOne({
      where: {
        type: ChannelType.LIVE_CHAT,
        externalAccountId: key,
        status: ChannelConnectionStatus.CONNECTED,
      },
    });
    if (!connection) throw new NotFoundException('Chat is not available');
    return connection;
  }

  private config(connection: ChannelConnection): LiveChatWidgetConfig {
    return connection.metadata as unknown as LiveChatWidgetConfig;
  }

  /**
   * Soft control only: the Origin header is set by browsers and can't be forged by a visitor's
   * page, but a script outside a browser can send anything. It stops the widget key being reused
   * on other people's sites; it is not authentication.
   */
  private assertOriginAllowed(connection: ChannelConnection, origin?: string) {
    const allowed = this.config(connection).allowedOrigins ?? [];
    if (allowed.length === 0) return;
    if (!origin || !allowed.includes(origin)) {
      throw new ForbiddenException('This site is not allowed to use this chat');
    }
  }

  async getConfig(key: string, origin?: string) {
    const connection = await this.findConnectedByKey(key);
    this.assertOriginAllowed(connection, origin);
    const config = this.config(connection);
    return {
      title: config.title,
      greeting: config.greeting,
      color: config.color,
      askName: config.askName ?? false,
      askEmail: true,
      offlineMessage: config.offlineMessage ?? '',
      online: isWithinHours(config.hours),
    };
  }

  async createSession(key: string, origin?: string) {
    const connection = await this.findConnectedByKey(key);
    this.assertOriginAllowed(connection, origin);
    const visitorId = randomUUID();
    const token = await this.jwtService.signAsync(
      { sub: visitorId, cid: connection.id, type: 'visitor' },
      {
        secret: this.configService.get<string>('auth.jwtSecret'),
        expiresIn: VISITOR_TOKEN_TTL,
      },
    );
    return { token, visitorId };
  }

  async authenticate(
    token: string | undefined,
    origin?: string,
  ): Promise<VisitorSession> {
    if (!token) throw new UnauthorizedException();
    let payload: { sub: string; cid: string; type: string };
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('auth.jwtSecret'),
      });
    } catch {
      throw new UnauthorizedException();
    }
    if (payload.type !== 'visitor') throw new UnauthorizedException();

    const connection = await this.connections.findOne({
      where: {
        id: payload.cid,
        type: ChannelType.LIVE_CHAT,
        status: ChannelConnectionStatus.CONNECTED,
      },
    });
    if (!connection) throw new NotFoundException('Chat is not available');
    this.assertOriginAllowed(connection, origin);
    return { visitorId: payload.sub, connection };
  }

  private findConversation(session: VisitorSession) {
    return this.conversations.findOne({
      where: {
        channelConnectionId: session.connection.id,
        externalConversationId: session.visitorId,
      },
    });
  }

  /** What the widget needs besides messages: are we open, and is an agent typing right now. */
  async getStatus(session: VisitorSession) {
    const conversation = await this.findConversation(session);
    const agentTyping = conversation
      ? (await this.redis.exists(`typing:agent:${conversation.id}`)) === 1
      : false;
    return {
      online: isWithinHours(this.config(session.connection).hours),
      agentTyping,
    };
  }

  /**
   * Moves agent messages forward SENT -> DELIVERED -> READ (never backwards) and tells the agents'
   * inboxes, whose message bubbles show the matching ticks.
   */
  private async advanceAgentMessages(
    rows: Message[],
    to: MessageStatus.DELIVERED | MessageStatus.READ,
  ): Promise<void> {
    const from =
      to === MessageStatus.DELIVERED
        ? [MessageStatus.SENT]
        : [MessageStatus.SENT, MessageStatus.DELIVERED];
    const due = rows.filter(
      (m) =>
        m.direction === MessageDirection.OUTBOUND && from.includes(m.status),
    );
    if (due.length === 0) return;
    await this.messages.update(
      { id: In(due.map((m) => m.id)), status: In(from) },
      { status: to },
    );
    for (const message of due) {
      message.status = to;
      this.realtime.toWorkspace(
        message.workspaceId,
        RealtimeEvent.MESSAGE_STATUS_CHANGED,
        message,
      );
      this.realtime.toConversation(
        message.conversationId,
        RealtimeEvent.MESSAGE_STATUS_CHANGED,
        message,
      );
    }
  }

  /** The visitor has the chat open and in view: everything the agents sent so far is read. */
  async markAgentMessagesRead(session: VisitorSession): Promise<void> {
    const conversation = await this.findConversation(session);
    if (!conversation) return;
    const rows = await this.messages.find({
      where: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        status: In([MessageStatus.SENT, MessageStatus.DELIVERED]),
      },
    });
    await this.advanceAgentMessages(rows, MessageStatus.READ);
  }

  /** Tells the agents' inboxes the visitor is typing. Cheap to call often: it emits at most once
   *  every couple of seconds per conversation. */
  async visitorTyping(session: VisitorSession): Promise<void> {
    const conversation = await this.findConversation(session);
    if (!conversation) return; // nothing to attach it to until the first message exists
    const fresh = await this.redis.set(
      `typing:visitor:${conversation.id}`,
      '1',
      'EX',
      2,
      'NX',
    );
    if (fresh) {
      this.realtime.toWorkspace(
        conversation.workspaceId,
        RealtimeEvent.CONVERSATION_TYPING,
        { conversationId: conversation.id, who: 'visitor' },
      );
    }
  }

  async listMessages(session: VisitorSession): Promise<WidgetMessageView[]> {
    const conversation = await this.findConversation(session);
    if (!conversation) return [];

    const rows = await this.messages.find({
      where: {
        conversationId: conversation.id,
        // Agent replies only become visible once actually sent; visitor messages always are.
        status: In([
          MessageStatus.RECEIVED,
          MessageStatus.SENT,
          MessageStatus.DELIVERED,
          MessageStatus.READ,
        ]),
      },
      relations: ['attachments'],
      order: { createdAt: 'DESC' },
      take: HISTORY_LIMIT,
    });

    // Fetching an agent's message is what "delivered" means for a widget.
    await this.advanceAgentMessages(rows, MessageStatus.DELIVERED);

    const workspace = await this.workspaces.findOne({
      where: { id: session.connection.workspaceId },
      select: { id: true, sendReadReceipts: true },
    });
    const shareReceipts = workspace?.sendReadReceipts ?? false;

    return Promise.all(
      rows.reverse().map(async (m) => ({
        id: m.id,
        clientId:
          m.direction === MessageDirection.INBOUND
            ? (m.externalMessageId ?? null)
            : null,
        direction: m.direction,
        content: m.content ?? '',
        sentAt: m.sentAt,
        seen:
          shareReceipts &&
          m.direction === MessageDirection.INBOUND &&
          m.status === MessageStatus.READ,
        attachments: await Promise.all(
          (m.attachments ?? [])
            .filter((a) => a.storageKey)
            .map(async (a) => ({
              name: a.fileName ?? 'file',
              size: a.fileSize ? Number(a.fileSize) : null,
              url: await this.storage.getSignedDownloadUrl(
                a.storageKey!,
                3600,
                a.fileName ?? 'file',
              ),
            })),
        ),
      })),
    );
  }

  async sendMessage(
    session: VisitorSession,
    input: {
      id: string;
      text?: string;
      pageUrl?: string;
      name?: string;
      email?: string;
    },
    visitor: VisitorInfo = {},
    file?: Express.Multer.File,
  ) {
    const text = (input.text ?? '').trim();
    if (!text && !file) throw new BadRequestException('Message is empty');
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `Messages are limited to ${MAX_MESSAGE_LENGTH} characters`,
      );
    }

    // Every chat is tied to a reachable email so a reply is possible after the visitor leaves.
    const profile = cleanProfile(input.name, input.email);
    if (!profile?.email) {
      throw new BadRequestException(
        'A valid email address is required to chat with us',
      );
    }

    const attachments: LiveChatInboundPayload['attachments'] = [];
    if (file) {
      const fileName = cleanFileName(file.originalname);
      if (
        file.size > MAX_WIDGET_FILE_BYTES ||
        !isAllowedWidgetFile(file.mimetype, fileName)
      ) {
        throw new BadRequestException(
          'This file type or size is not allowed (images, PDF, text, Office files up to 5 MB)',
        );
      }
      const storageKey = this.storage.buildKey(
        session.connection.workspaceId,
        fileName,
      );
      await this.storage.upload(storageKey, file.buffer, file.mimetype);
      attachments.push({
        storageKey,
        mimeType: file.mimetype,
        fileName,
        size: file.size,
      });
    }

    const payload: LiveChatInboundPayload = {
      visitorId: session.visitorId,
      messageId: input.id,
      text,
      visitor: { ...visitor, pageUrl: sanitizePageUrl(input.pageUrl) },
      profile,
      ...(attachments.length && { attachments }),
    };
    // Same idempotent ingest + queue path every provider webhook uses: a retried POST with the
    // same client id is dropped at the webhook_events unique key.
    await this.webhooksService.ingest(
      'livechat',
      session.connection.id,
      payload,
      [`livechat:${input.id}`],
    );
    return { id: input.id };
  }
}

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** The pre-chat form is untrusted input that ends up in the agents' inbox: keep it short and plain. */
export function cleanProfile(
  name?: string,
  email?: string,
): { name?: string; email?: string } | undefined {
  // eslint-disable-next-line no-control-regex
  const cleanName = name
    ?.replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 80);
  const cleanEmail = email?.trim().toLowerCase();
  const profile = {
    ...(cleanName && { name: cleanName }),
    ...(cleanEmail &&
      cleanEmail.length <= 254 &&
      EMAIL_RE.test(cleanEmail) && { email: cleanEmail }),
  };
  return Object.keys(profile).length ? profile : undefined;
}
