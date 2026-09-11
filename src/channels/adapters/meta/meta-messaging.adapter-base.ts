import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { ChannelConnection } from '../../entities/channel-connection.entity';
import { ChannelType } from '../../enums/channel-type.enum';
import {
  ChannelAdapter,
  ChannelCapabilities,
  NormalizedWebhookEvent,
  OutboundMessage,
  SendMessageResult,
  UnifiedConversation,
  WebhookVerificationRequest,
  WebhookVerificationResult,
} from '../../interfaces/channel-adapter.interface';
import { MessageSendFailedException } from '../../../common/exceptions/app.exception';
import {
  MessageStatus,
  MessageType,
} from '../../../messages/enums/message.enums';
import { MetaWebhookPayload } from './meta.types';

/**
 * Shared behaviour for Messenger and Instagram: both ride the same Meta Graph API Send API and
 * the same webhook envelope/signature scheme, differing only in the `object` discriminator and
 * a couple of field names. See docs/social-platform-capabilities.md for the App Review /
 * Business Verification caveats that apply to both.
 */
export abstract class MetaMessagingAdapterBase implements ChannelAdapter {
  abstract readonly type: ChannelType;
  abstract readonly webhookObjectType: 'page' | 'instagram';

  readonly capabilities: ChannelCapabilities = {
    sendText: true,
    sendImage: true,
    sendVideo: true,
    sendAudio: true,
    sendDocument: true,
    markAsRead: true,
    deliveryReceipts: true,
    readReceipts: true,
  };

  protected readonly logger = new Logger(this.constructor.name);

  constructor(protected readonly configService: ConfigService) {}

  private get apiVersion() {
    return this.configService.get<string>('meta.apiVersion') ?? 'v21.0';
  }

  private graphUrl(path: string, accessToken: string) {
    const separator = path.includes('?') ? '&' : '?';
    return `https://graph.facebook.com/${this.apiVersion}/${path}${separator}access_token=${encodeURIComponent(accessToken)}`;
  }

  abstract connect(input: Record<string, unknown>): Promise<{
    externalAccountId: string;
    externalAccountName?: string;
    credentials: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>;

  async disconnect(_connection: ChannelConnection): Promise<void> {
    // Webhook subscriptions live at the Meta app level; nothing per-connection to tear down.
  }

  async sendMessage(
    connection: ChannelConnection,
    conversation: UnifiedConversation,
    message: OutboundMessage,
  ): Promise<SendMessageResult> {
    const accessToken = connection.credentials?.pageAccessToken as string;
    const payload = {
      recipient: { id: conversation.externalConversationId },
      message: this.buildMessagePayload(message),
    };

    const response = await fetch(this.graphUrl('me/messages', accessToken), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as {
      message_id?: string;
      error?: { message: string };
    };

    if (!response.ok || !body.message_id) {
      throw new MessageSendFailedException(
        body.error?.message ?? 'Meta rejected this message',
      );
    }

    return { externalMessageId: body.message_id, status: MessageStatus.SENT };
  }

  private buildMessagePayload(message: OutboundMessage) {
    if (message.attachment) {
      const type = this.attachmentTypeFor(message.type);
      return {
        attachment: {
          type,
          payload: { url: message.attachment.url, is_reusable: true },
        },
      };
    }
    return { text: message.text };
  }

  private attachmentTypeFor(
    type: MessageType,
  ): 'image' | 'video' | 'audio' | 'file' {
    switch (type) {
      case MessageType.IMAGE:
        return 'image';
      case MessageType.VIDEO:
        return 'video';
      case MessageType.AUDIO:
        return 'audio';
      default:
        return 'file';
    }
  }

  async markAsRead(
    connection: ChannelConnection,
    conversation: UnifiedConversation,
  ): Promise<void> {
    const accessToken = connection.credentials?.pageAccessToken as string;
    await fetch(this.graphUrl('me/messages', accessToken), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        recipient: { id: conversation.externalConversationId },
        sender_action: 'mark_seen',
      }),
    }).catch((error) =>
      this.logger.warn(`Failed to mark message seen: ${error.message}`),
    );
  }

  verifyWebhookHandshake(
    request: WebhookVerificationRequest,
  ): WebhookVerificationResult {
    const verifyToken = this.configService.get<string>('meta.verifyToken');
    if (
      request.query['hub.mode'] === 'subscribe' &&
      request.query['hub.verify_token'] === verifyToken
    ) {
      return { ok: true, challenge: request.query['hub.challenge'] };
    }
    return { ok: false };
  }

  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const appSecret = this.configService.get<string>('meta.appSecret');
    if (!appSecret) return true; // dev-only convenience when no app secret is configured yet
    const signatureHeader = headers['x-hub-signature-256'];
    const signature = Array.isArray(signatureHeader)
      ? signatureHeader[0]
      : signatureHeader;
    if (!signature) return false;

    const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(signature);
    return (
      expectedBuf.length === providedBuf.length &&
      timingSafeEqual(expectedBuf, providedBuf)
    );
  }

  extractExternalAccountId(payload: unknown): string | null {
    const body = payload as MetaWebhookPayload;
    if (body?.object !== this.webhookObjectType) return null;
    return body.entry?.[0]?.id ?? null;
  }

  extractEventKeys(payload: unknown): string[] {
    const body = payload as MetaWebhookPayload;
    if (body?.object !== this.webhookObjectType) return [];
    const keys: string[] = [];
    for (const entry of body.entry ?? []) {
      for (const item of entry.messaging ?? []) {
        if (item.message)
          keys.push(`${this.webhookObjectType}:message:${item.message.mid}`);
        else if (item.delivery)
          keys.push(
            `${this.webhookObjectType}:delivery:${item.delivery.watermark}:${item.sender.id}`,
          );
        else if (item.read)
          keys.push(
            `${this.webhookObjectType}:read:${item.read.watermark}:${item.sender.id}`,
          );
      }
    }
    return keys;
  }

  async handleWebhook(
    payload: unknown,
    _connection: ChannelConnection,
  ): Promise<NormalizedWebhookEvent[]> {
    const body = payload as MetaWebhookPayload;
    if (body?.object !== this.webhookObjectType) return [];

    const events: NormalizedWebhookEvent[] = [];
    for (const entry of body.entry ?? []) {
      for (const item of entry.messaging ?? []) {
        if (item.message && !item.message.is_echo) {
          events.push({
            kind: 'INBOUND_MESSAGE',
            externalConversationId: item.sender.id,
            externalMessageId: item.message.mid,
            contact: { externalUserId: item.sender.id },
            messageType: this.resolveMessageType(
              item.message.attachments?.[0]?.type,
            ),
            content: item.message.text,
            attachments: (item.message.attachments ?? [])
              .filter((a) => a.payload.url)
              .map((a) => ({
                url: a.payload.url!,
                mimeType: this.mimeTypeFor(a.type),
              })),
            sentAt: new Date(item.timestamp),
            raw: item,
          });
        } else if (item.delivery?.mids) {
          for (const mid of item.delivery.mids) {
            events.push({
              kind: 'MESSAGE_STATUS',
              externalMessageId: mid,
              status: MessageStatus.DELIVERED,
              occurredAt: new Date(item.delivery.watermark),
              raw: item,
            });
          }
        }
        // `read` events carry only a watermark timestamp, not specific message ids, so they
        // can't be mapped onto a single message's status the way delivery/read receipts can
        // for WhatsApp — intentionally not translated into a MESSAGE_STATUS event.
      }
    }
    return events;
  }

  private resolveMessageType(attachmentType?: string): MessageType {
    switch (attachmentType) {
      case 'image':
        return MessageType.IMAGE;
      case 'video':
        return MessageType.VIDEO;
      case 'audio':
        return MessageType.AUDIO;
      case 'file':
        return MessageType.DOCUMENT;
      default:
        return MessageType.TEXT;
    }
  }

  private mimeTypeFor(type: string): string {
    switch (type) {
      case 'image':
        return 'image/jpeg';
      case 'video':
        return 'video/mp4';
      case 'audio':
        return 'audio/mpeg';
      default:
        return 'application/octet-stream';
    }
  }
}
