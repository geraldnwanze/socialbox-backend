import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
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
  WebhookVerificationRequest,
  WebhookVerificationResult,
} from '../../interfaces/channel-adapter.interface';
import { MessageSendFailedException } from '../../../common/exceptions/app.exception';
import {
  MessageStatus,
  MessageType,
} from '../../../messages/enums/message.enums';
import {
  WhatsAppInboundMessage,
  WhatsAppWebhookPayload,
} from './whatsapp.types';

/**
 * WhatsApp Cloud API — see docs/social-platform-capabilities.md. Fully functional against a
 * Meta developer test number; production use against a real business number additionally
 * requires Meta Business Verification, which is an offline process outside this codebase.
 */
@Injectable()
export class WhatsAppAdapter implements ChannelAdapter {
  readonly type = ChannelType.WHATSAPP;
  readonly capabilities: ChannelCapabilities = {
    sendText: true,
    sendImage: true,
    sendVideo: true,
    sendAudio: true,
    sendDocument: true,
    markAsRead: true,
    markAsReadNotifiesCustomer: true,
    deliveryReceipts: true,
    readReceipts: true,
  };

  private readonly logger = new Logger(WhatsAppAdapter.name);

  constructor(private readonly configService: ConfigService) {}

  private get apiVersion() {
    return this.configService.get<string>('whatsapp.apiVersion') ?? 'v21.0';
  }

  private graphUrl(path: string) {
    return `https://graph.facebook.com/${this.apiVersion}/${path}`;
  }

  async connect(input: ConnectChannelInput): Promise<ConnectChannelResult> {
    const accessToken = input.accessToken as string;
    const phoneNumberId = input.phoneNumberId as string;
    if (!accessToken || !phoneNumberId) {
      throw new MessageSendFailedException(
        'An access token and phone number id are required',
      );
    }

    const response = await fetch(
      this.graphUrl(
        `${phoneNumberId}?fields=verified_name,display_phone_number`,
      ),
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    const body = (await response.json()) as {
      verified_name?: string;
      display_phone_number?: string;
      error?: { message: string };
    };
    if (!response.ok) {
      throw new MessageSendFailedException(
        body.error?.message ?? 'Meta rejected these credentials',
      );
    }

    return {
      externalAccountId: phoneNumberId,
      externalAccountName: body.verified_name ?? body.display_phone_number,
      credentials: { accessToken, phoneNumberId },
      metadata: { displayPhoneNumber: body.display_phone_number },
    };
  }

  async disconnect(_connection: ChannelConnection): Promise<void> {
    // Cloud API webhooks are configured at the Meta app level, not per phone number —
    // nothing provider-side to tear down for a single connection.
  }

  async sendMessage(
    connection: ChannelConnection,
    conversation: UnifiedConversation,
    message: OutboundMessage,
  ): Promise<SendMessageResult> {
    const accessToken = connection.credentials?.accessToken as string;
    const phoneNumberId = connection.credentials?.phoneNumberId as string;

    const payload = this.buildSendPayload(
      conversation.externalConversationId,
      message,
    );

    const response = await fetch(this.graphUrl(`${phoneNumberId}/messages`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const body = (await response.json()) as {
      messages?: { id: string }[];
      error?: { message: string; code: number };
    };

    if (!response.ok || !body.messages?.[0]) {
      // Outside the 24h customer service window, Meta rejects free-form text with a specific
      // error code (131047 / 470) — surfaced as-is rather than silently "succeeding".
      throw new MessageSendFailedException(
        body.error?.message ?? 'WhatsApp rejected this message',
      );
    }

    return {
      externalMessageId: body.messages[0].id,
      status: MessageStatus.SENT,
    };
  }

  private buildSendPayload(to: string, message: OutboundMessage) {
    const base = { messaging_product: 'whatsapp', to };
    switch (message.type) {
      case MessageType.IMAGE:
        return {
          ...base,
          type: 'image',
          image: { link: message.attachment?.url, caption: message.text },
        };
      case MessageType.VIDEO:
        return {
          ...base,
          type: 'video',
          video: { link: message.attachment?.url, caption: message.text },
        };
      case MessageType.AUDIO:
        return {
          ...base,
          type: 'audio',
          audio: { link: message.attachment?.url },
        };
      case MessageType.DOCUMENT:
        return {
          ...base,
          type: 'document',
          document: {
            link: message.attachment?.url,
            filename: message.attachment?.fileName,
            caption: message.text,
          },
        };
      default:
        return {
          ...base,
          type: 'text',
          text: { body: message.text, preview_url: true },
        };
    }
  }

  async markAsRead(
    connection: ChannelConnection,
    conversation: UnifiedConversation,
  ): Promise<void> {
    if (!conversation.lastInboundExternalMessageId) return;
    const accessToken = connection.credentials?.accessToken as string;
    const phoneNumberId = connection.credentials?.phoneNumberId as string;
    await fetch(this.graphUrl(`${phoneNumberId}/messages`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: conversation.lastInboundExternalMessageId,
      }),
    }).catch((error) =>
      this.logger.warn(
        `Failed to mark WhatsApp message read: ${error.message}`,
      ),
    );
  }

  verifyWebhookHandshake(
    request: WebhookVerificationRequest,
  ): WebhookVerificationResult {
    const verifyToken = this.configService.get<string>('whatsapp.verifyToken');
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
    const appSecret = this.configService.get<string>('whatsapp.appSecret');
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
    const body = payload as WhatsAppWebhookPayload;
    return (
      body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ?? null
    );
  }

  extractEventKeys(payload: unknown): string[] {
    const body = payload as WhatsAppWebhookPayload;
    const keys: string[] = [];
    for (const entry of body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const message of change.value.messages ?? []) {
          keys.push(`whatsapp:message:${message.id}`);
        }
        for (const status of change.value.statuses ?? []) {
          keys.push(`whatsapp:status:${status.id}:${status.status}`);
        }
      }
    }
    return keys;
  }

  async handleWebhook(
    payload: unknown,
    connection: ChannelConnection,
  ): Promise<NormalizedWebhookEvent[]> {
    const body = payload as WhatsAppWebhookPayload;
    const events: NormalizedWebhookEvent[] = [];
    const accessToken = connection.credentials?.accessToken as string;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const contactName = value.contacts?.[0]?.profile?.name;

        for (const message of value.messages ?? []) {
          const attachments = await this.resolveAttachments(
            message,
            accessToken,
          );
          events.push({
            kind: 'INBOUND_MESSAGE',
            externalConversationId: message.from,
            externalMessageId: message.id,
            contact: { externalUserId: message.from, displayName: contactName },
            messageType: this.resolveMessageType(message.type),
            content: message.text?.body,
            attachments,
            sentAt: new Date(Number(message.timestamp) * 1000),
            raw: message,
          });
        }

        for (const status of value.statuses ?? []) {
          events.push({
            kind: 'MESSAGE_STATUS',
            externalMessageId: status.id,
            status: this.mapStatus(status.status),
            occurredAt: new Date(Number(status.timestamp) * 1000),
            failureReason: status.errors?.[0]?.title,
            raw: status,
          });
        }
      }
    }

    return events;
  }

  private resolveMessageType(type: string): MessageType {
    switch (type) {
      case 'image':
        return MessageType.IMAGE;
      case 'video':
        return MessageType.VIDEO;
      case 'audio':
        return MessageType.AUDIO;
      case 'document':
        return MessageType.DOCUMENT;
      case 'sticker':
        return MessageType.STICKER;
      case 'text':
        return MessageType.TEXT;
      default:
        return MessageType.UNKNOWN;
    }
  }

  private mapStatus(status: string): MessageStatus {
    switch (status) {
      case 'sent':
        return MessageStatus.SENT;
      case 'delivered':
        return MessageStatus.DELIVERED;
      case 'read':
        return MessageStatus.READ;
      case 'failed':
        return MessageStatus.FAILED;
      default:
        return MessageStatus.SENT;
    }
  }

  private async resolveAttachments(
    message: WhatsAppInboundMessage,
    accessToken: string,
  ) {
    const media =
      message.image ??
      message.video ??
      message.audio ??
      message.document ??
      message.sticker;
    if (!media?.id) return [];

    try {
      const metaResponse = await fetch(this.graphUrl(media.id), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const metaBody = (await metaResponse.json()) as {
        url?: string;
        mime_type?: string;
      };
      if (!metaBody.url) return [];
      return [
        {
          url: metaBody.url,
          mimeType:
            metaBody.mime_type ?? media.mime_type ?? 'application/octet-stream',
          fileName: media.filename,
        },
      ];
    } catch (error) {
      this.logger.warn(
        `Failed to resolve WhatsApp media URL: ${(error as Error).message}`,
      );
      return [];
    }
  }
}
