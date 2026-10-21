import { HttpStatus, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ChannelConnection } from '../../entities/channel-connection.entity';
import { ChannelType } from '../../enums/channel-type.enum';
import {
  ChannelAdapter,
  ChannelCapabilities,
  ConnectChannelInput,
  ConnectChannelResult,
  NormalizedWebhookEvent,
  OutboundMessage,
  SendMessageResult,
  UnifiedConversation,
} from '../../interfaces/channel-adapter.interface';
import { AppException } from '../../../common/exceptions/app.exception';
import {
  MessageStatus,
  MessageType,
} from '../../../messages/enums/message.enums';

export interface LiveChatInboundPayload {
  visitorId: string;
  /** Client-generated id, so a retried POST from the widget can't create a second message. */
  messageId: string;
  text: string;
  /** Facts about the visitor, captured server-side from the request (never trusted from the page
   *  except pageUrl, which is only ever displayed). */
  visitor?: {
    ip?: string;
    countryCode?: string;
    pageUrl?: string;
  };
}

export interface LiveChatWidgetConfig {
  title: string;
  greeting: string;
  color: string;
  allowedOrigins: string[];
}

const DEFAULTS = {
  title: 'Chat with us',
  greeting: 'Hi! How can we help?',
  color: '#4F46E5',
};

/**
 * Website chat widget. Unlike the third-party channels there is no provider to call: the
 * "account" is a public widget key we generate, inbound messages arrive from the widget through
 * our own public API (queued like any provider webhook), and "sending" to the visitor just
 * means the message exists in our database — the widget polls for it.
 */
@Injectable()
export class LiveChatAdapter implements ChannelAdapter {
  readonly type = ChannelType.LIVE_CHAT;
  readonly capabilities: ChannelCapabilities = {
    sendText: true,
    sendImage: false,
    sendVideo: false,
    sendAudio: false,
    sendDocument: false,
    markAsRead: false,
    deliveryReceipts: false,
    readReceipts: false,
  };

  async connect(input: ConnectChannelInput): Promise<ConnectChannelResult> {
    const config = this.parseConfig(input);
    const previous = input.previousExternalAccountId;
    const widgetKey =
      typeof previous === 'string' && previous
        ? previous
        : `wk_${randomBytes(16).toString('hex')}`;

    return {
      externalAccountId: widgetKey,
      externalAccountName: config.title,
      credentials: {},
      metadata: { ...config },
    };
  }

  private parseConfig(input: ConnectChannelInput): LiveChatWidgetConfig {
    const str = (value: unknown, fallback: string, max: number) => {
      if (value === undefined || value === null || value === '')
        return fallback;
      if (typeof value !== 'string' || value.length > max) {
        throw this.invalid(`Values must be text of at most ${max} characters`);
      }
      return value.trim() || fallback;
    };

    const color = str(input.color, DEFAULTS.color, 7);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
      throw this.invalid('Color must be a hex value like #4F46E5');
    }

    const rawOrigins = Array.isArray(input.allowedOrigins)
      ? input.allowedOrigins
      : String(input.allowedOrigins ?? '')
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean);

    const allowedOrigins = rawOrigins.map((origin) => {
      try {
        const url = new URL(String(origin));
        if (url.protocol !== 'https:' && url.protocol !== 'http:')
          throw new Error();
        return url.origin;
      } catch {
        throw this.invalid(
          `"${origin}" is not a valid site address — use the form https://example.com`,
        );
      }
    });

    return {
      title: str(input.title, DEFAULTS.title, 60),
      greeting: str(input.greeting, DEFAULTS.greeting, 200),
      color,
      allowedOrigins: [...new Set(allowedOrigins)],
    };
  }

  private invalid(message: string) {
    return new AppException(
      'INVALID_CHANNEL_SETTINGS',
      message,
      HttpStatus.BAD_REQUEST,
    );
  }

  async disconnect(_connection: ChannelConnection): Promise<void> {
    // Nothing provider-side. The widget stops working because the connection is no longer
    // CONNECTED, which every public widget endpoint checks.
  }

  async sendMessage(
    _connection: ChannelConnection,
    _conversation: UnifiedConversation,
    message: OutboundMessage,
  ): Promise<SendMessageResult> {
    if (message.type !== MessageType.TEXT) {
      throw new AppException(
        'UNSUPPORTED_MESSAGE_TYPE',
        'Live chat supports text messages only',
        HttpStatus.BAD_REQUEST,
      );
    }
    // The message row is already what the widget reads; reaching SENT is what makes it visible.
    return {
      externalMessageId: `lc_out_${randomBytes(8).toString('hex')}`,
      status: MessageStatus.SENT,
    };
  }

  // Inbound traffic comes through our own authenticated widget API, never an external webhook.
  verifySignature(): boolean {
    return false;
  }

  extractExternalAccountId(): string | null {
    return null;
  }

  extractEventKeys(payload: unknown): string[] {
    const p = payload as Partial<LiveChatInboundPayload>;
    return p?.messageId ? [`livechat:${p.messageId}`] : [];
  }

  async handleWebhook(
    payload: unknown,
    _connection: ChannelConnection,
  ): Promise<NormalizedWebhookEvent[]> {
    const p = payload as LiveChatInboundPayload;
    return [
      {
        kind: 'INBOUND_MESSAGE',
        externalConversationId: p.visitorId,
        externalMessageId: p.messageId,
        contact: {
          externalUserId: p.visitorId,
          displayName: `Website visitor ${p.visitorId.slice(0, 4).toUpperCase()}`,
          metadata: p.visitor
            ? { ...p.visitor, lastSeenAt: new Date().toISOString() }
            : undefined,
        },
        messageType: MessageType.TEXT,
        content: p.text,
        attachments: [],
        sentAt: new Date(),
        raw: p,
      },
    ];
  }
}
