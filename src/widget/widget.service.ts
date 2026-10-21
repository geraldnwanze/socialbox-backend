import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import {
  MessageDirection,
  MessageStatus,
} from '../messages/enums/message.enums';
import { WebhooksService } from '../webhooks/webhooks.service';
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
    const { title, greeting, color } = this.config(connection);
    return { title, greeting, color };
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

  async listMessages(session: VisitorSession): Promise<WidgetMessageView[]> {
    const conversation = await this.conversations.findOne({
      where: {
        channelConnectionId: session.connection.id,
        externalConversationId: session.visitorId,
      },
    });
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
      order: { createdAt: 'DESC' },
      take: HISTORY_LIMIT,
    });

    return rows.reverse().map((m) => ({
      id: m.id,
      clientId:
        m.direction === MessageDirection.INBOUND
          ? (m.externalMessageId ?? null)
          : null,
      direction: m.direction,
      content: m.content ?? '',
      sentAt: m.sentAt,
    }));
  }

  async sendMessage(
    session: VisitorSession,
    input: { id: string; text: string; pageUrl?: string },
    visitor: VisitorInfo = {},
  ) {
    const text = input.text.trim();
    if (!text) throw new BadRequestException('Message is empty');
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `Messages are limited to ${MAX_MESSAGE_LENGTH} characters`,
      );
    }

    const payload: LiveChatInboundPayload = {
      visitorId: session.visitorId,
      messageId: input.id,
      text,
      visitor: { ...visitor, pageUrl: sanitizePageUrl(input.pageUrl) },
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
