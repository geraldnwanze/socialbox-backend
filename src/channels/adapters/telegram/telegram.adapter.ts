import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { MessageSendFailedException } from '../../../common/exceptions/app.exception';
import {
  MessageStatus,
  MessageType,
} from '../../../messages/enums/message.enums';
import {
  TelegramFile,
  TelegramSendResponse,
  TelegramUpdate,
  TelegramUser,
} from './telegram.types';

/**
 * Reference adapter implementation — Telegram's Bot API requires no app review or business
 * verification, which is why it is the first channel proven end-to-end. See
 * docs/social-platform-capabilities.md for what is/isn't supported.
 */
@Injectable()
export class TelegramAdapter implements ChannelAdapter {
  readonly type = ChannelType.TELEGRAM;
  readonly capabilities: ChannelCapabilities = {
    sendText: true,
    sendImage: true,
    sendVideo: true,
    sendAudio: true,
    sendDocument: true,
    markAsRead: false,
    deliveryReceipts: false,
    readReceipts: false,
  };

  private readonly logger = new Logger(TelegramAdapter.name);

  constructor(private readonly configService: ConfigService) {}

  private apiBase(botToken: string) {
    return `https://api.telegram.org/bot${botToken}`;
  }

  async connect(input: ConnectChannelInput): Promise<ConnectChannelResult> {
    const botToken = input.botToken as string;
    if (!botToken) {
      throw new MessageSendFailedException('A Telegram bot token is required');
    }

    const response = await fetch(`${this.apiBase(botToken)}/getMe`);
    const body = (await response.json()) as {
      ok: boolean;
      result?: TelegramUser;
      description?: string;
    };
    if (!body.ok || !body.result) {
      throw new MessageSendFailedException(
        body.description ?? 'Telegram rejected this bot token',
      );
    }

    return {
      externalAccountId: String(body.result.id),
      externalAccountName: body.result.username ?? body.result.first_name,
      credentials: { botToken },
      metadata: { username: body.result.username },
    };
  }

  async disconnect(connection: ChannelConnection): Promise<void> {
    const botToken = connection.credentials?.botToken as string;
    if (!botToken) return;
    await fetch(`${this.apiBase(botToken)}/deleteWebhook`, {
      method: 'POST',
    }).catch((error) =>
      this.logger.warn(
        `Failed to delete Telegram webhook on disconnect: ${error.message}`,
      ),
    );
  }

  async configureWebhook(connection: ChannelConnection): Promise<void> {
    const botToken = connection.credentials?.botToken as string;
    const secret = this.configService.get<string>('telegram.webhookSecret');
    const apiUrl = this.configService.get<string>('apiUrl');
    const webhookUrl = `${apiUrl}/webhooks/telegram/${connection.id}`;

    const response = await fetch(`${this.apiBase(botToken)}/setWebhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: ['message'],
      }),
    });
    const body = (await response.json()) as {
      ok: boolean;
      description?: string;
    };
    if (!body.ok) {
      throw new MessageSendFailedException(
        body.description ?? 'Failed to register Telegram webhook',
      );
    }
  }

  async sendMessage(
    connection: ChannelConnection,
    conversation: UnifiedConversation,
    message: OutboundMessage,
  ): Promise<SendMessageResult> {
    const botToken = connection.credentials?.botToken as string;
    const chatId = conversation.externalConversationId;

    const { method, payload } = this.buildSendPayload(chatId, message);

    const response = await fetch(`${this.apiBase(botToken)}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as TelegramSendResponse;

    if (!body.ok || !body.result) {
      throw new MessageSendFailedException(
        body.description ?? 'Telegram rejected this message',
      );
    }

    return {
      externalMessageId: String(body.result.message_id),
      status: MessageStatus.SENT,
    };
  }

  private buildSendPayload(chatId: string, message: OutboundMessage) {
    switch (message.type) {
      case MessageType.IMAGE:
        return {
          method: 'sendPhoto',
          payload: {
            chat_id: chatId,
            photo: message.attachment?.url,
            caption: message.text,
          },
        };
      case MessageType.VIDEO:
        return {
          method: 'sendVideo',
          payload: {
            chat_id: chatId,
            video: message.attachment?.url,
            caption: message.text,
          },
        };
      case MessageType.AUDIO:
        return {
          method: 'sendAudio',
          payload: {
            chat_id: chatId,
            audio: message.attachment?.url,
            caption: message.text,
          },
        };
      case MessageType.DOCUMENT:
        return {
          method: 'sendDocument',
          payload: {
            chat_id: chatId,
            document: message.attachment?.url,
            caption: message.text,
          },
        };
      default:
        return {
          method: 'sendMessage',
          payload: { chat_id: chatId, text: message.text },
        };
    }
  }

  verifySignature(
    _rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const configuredSecret = this.configService.get<string>(
      'telegram.webhookSecret',
    );
    if (!configuredSecret) return true; // no secret configured (dev-only convenience)
    const provided = headers['x-telegram-bot-api-secret-token'];
    return provided === configuredSecret;
  }

  // Telegram routes webhooks per-connection via the URL path (see configureWebhook), so the
  // payload itself never needs to identify which bot/account it belongs to.
  extractExternalAccountId(_payload: unknown): string | null {
    return null;
  }

  extractEventKeys(payload: unknown): string[] {
    const update = payload as TelegramUpdate;
    return update?.update_id !== undefined
      ? [`telegram:${update.update_id}`]
      : [];
  }

  async handleWebhook(
    payload: unknown,
    connection: ChannelConnection,
  ): Promise<NormalizedWebhookEvent[]> {
    const update = payload as TelegramUpdate;
    const message = update.message;
    if (!message) return [];

    const botToken = connection.credentials?.botToken as string;
    const attachments = await this.resolveAttachments(message, botToken);

    return [
      {
        kind: 'INBOUND_MESSAGE',
        externalConversationId: String(message.chat.id),
        externalMessageId: String(message.message_id),
        contact: {
          externalUserId: String(message.from.id),
          username: message.from.username,
          displayName: [message.from.first_name, message.from.last_name]
            .filter(Boolean)
            .join(' '),
        },
        messageType: this.resolveMessageType(message),
        content: message.text ?? message.caption,
        attachments,
        sentAt: new Date(message.date * 1000),
        raw: update,
      },
    ];
  }

  private resolveMessageType(message: TelegramUpdate['message']): MessageType {
    if (message?.photo) return MessageType.IMAGE;
    if (message?.video) return MessageType.VIDEO;
    if (message?.voice || message?.audio) return MessageType.AUDIO;
    if (message?.document) return MessageType.DOCUMENT;
    if (message?.sticker) return MessageType.STICKER;
    if (message?.text) return MessageType.TEXT;
    return MessageType.UNKNOWN;
  }

  private async resolveAttachments(
    message: NonNullable<TelegramUpdate['message']>,
    botToken: string,
  ) {
    const fileId =
      message.photo?.at(-1)?.file_id ??
      message.video?.file_id ??
      message.voice?.file_id ??
      message.audio?.file_id ??
      message.document?.file_id ??
      message.sticker?.file_id;
    if (!fileId) return [];

    try {
      const response = await fetch(
        `${this.apiBase(botToken)}/getFile?file_id=${fileId}`,
      );
      const body = (await response.json()) as {
        ok: boolean;
        result?: TelegramFile;
      };
      if (!body.ok || !body.result?.file_path) return [];
      return [
        {
          url: `https://api.telegram.org/file/bot${botToken}/${body.result.file_path}`,
          mimeType: message.document?.mime_type ?? 'application/octet-stream',
          fileName: message.document?.file_name,
        },
      ];
    } catch (error) {
      this.logger.warn(
        `Failed to resolve Telegram file for message: ${(error as Error).message}`,
      );
      return [];
    }
  }
}
