import { ChannelConnection } from '../entities/channel-connection.entity';
import { ChannelType } from '../enums/channel-type.enum';
import { MessageStatus, MessageType } from '../../messages/enums/message.enums';

/** Capabilities the composer/UI uses to decide what controls to show for a connected channel. */
export interface ChannelCapabilities {
  sendText: boolean;
  sendImage: boolean;
  sendVideo: boolean;
  sendAudio: boolean;
  sendDocument: boolean;
  markAsRead: boolean;
  deliveryReceipts: boolean;
  readReceipts: boolean;
}

/** The minimal view of a conversation an adapter needs in order to send into it. */
export interface UnifiedConversation {
  id: string;
  externalConversationId: string;
  contactExternalId: string;
  /** External id of the most recent inbound message, needed by providers whose "mark read"
   *  call operates on a specific message rather than the conversation as a whole. */
  lastInboundExternalMessageId?: string;
  /** Subject of that inbound message (email only) so the reply can be threaded under it. */
  lastInboundSubject?: string;
}

export interface OutboundAttachment {
  url: string;
  mimeType: string;
  fileName?: string;
}

export interface OutboundMessage {
  type: MessageType;
  text?: string;
  attachment?: OutboundAttachment;
}

export interface SendMessageResult {
  externalMessageId: string;
  status: MessageStatus;
}

/** Input required to activate a new connection; shape varies per provider (see each adapter). */
export type ConnectChannelInput = Record<string, unknown>;

export interface ConnectChannelResult {
  externalAccountId: string;
  externalAccountName?: string;
  credentials: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  tokenExpiresAt?: Date;
}

export interface NormalizedInboundMessage {
  kind: 'INBOUND_MESSAGE';
  externalConversationId: string;
  externalMessageId: string;
  contact: {
    externalUserId: string;
    username?: string;
    displayName?: string;
    /** Provider-specific facts about the person (e.g. IP/country/page for live chat). Merged
     *  into the contact identity's metadata on every message. */
    metadata?: Record<string, unknown>;
  };
  messageType: MessageType;
  content?: string;
  /** Provider facts about this one message (e.g. an email's subject), stored on the message. */
  messageMetadata?: Record<string, unknown>;
  attachments: OutboundAttachment[];
  sentAt: Date;
  raw: unknown;
}

export interface NormalizedMessageStatus {
  kind: 'MESSAGE_STATUS';
  externalMessageId: string;
  status: MessageStatus;
  occurredAt: Date;
  failureReason?: string;
  raw: unknown;
}

export type NormalizedWebhookEvent =
  NormalizedInboundMessage | NormalizedMessageStatus;

export interface WebhookVerificationRequest {
  query: Record<string, string | undefined>;
}

export interface WebhookVerificationResult {
  ok: boolean;
  challenge?: string;
}

/**
 * The seam between the core messaging domain and a specific social/messaging platform.
 * The rest of the application (ConversationsService, MessagesService, ...) only ever talks
 * to this interface — never to a provider SDK/HTTP client directly.
 */
export interface ChannelAdapter {
  readonly type: ChannelType;
  readonly capabilities: ChannelCapabilities;

  connect(input: ConnectChannelInput): Promise<ConnectChannelResult>;
  disconnect(connection: ChannelConnection): Promise<void>;

  sendMessage(
    connection: ChannelConnection,
    conversation: UnifiedConversation,
    message: OutboundMessage,
  ): Promise<SendMessageResult>;

  markAsRead?(
    connection: ChannelConnection,
    conversation: UnifiedConversation,
  ): Promise<void>;

  /** Registers/updates the provider-side webhook URL for this specific connection, for
   *  providers (Telegram) that use a connection-scoped callback URL rather than one static
   *  app-level URL configured once in a developer dashboard (Meta family). */
  configureWebhook?(connection: ChannelConnection): Promise<void>;

  /** GET handshake some providers (Meta) require when registering a webhook URL. */
  verifyWebhookHandshake?(
    request: WebhookVerificationRequest,
  ): WebhookVerificationResult;

  /** Cryptographic verification that a webhook POST really came from the provider. */
  verifySignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean;

  /** Pulls out the provider account id (phone number id / page id / bot id) so the correct
   *  ChannelConnection row can be resolved before any DB writes happen. */
  extractExternalAccountId(payload: unknown): string | null;

  /** One idempotency key per atomic event inside the payload (a single webhook POST can bundle
   *  several messages/status updates). */
  extractEventKeys(payload: unknown): string[];

  handleWebhook(
    payload: unknown,
    connection: ChannelConnection,
  ): Promise<NormalizedWebhookEvent[]>;
}
