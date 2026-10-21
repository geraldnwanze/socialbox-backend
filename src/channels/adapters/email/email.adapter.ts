import { HttpStatus, Injectable } from '@nestjs/common';
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
import { AppException } from '../../../common/exceptions/app.exception';
import {
  MessageStatus,
  MessageType,
} from '../../../messages/enums/message.enums';
import { EmailCredentials, parseEmailInput } from './email-config';
import {
  createImapClient,
  createSmtpTransport,
  describeMailError,
} from './email-clients';
import { nameFromAddress, replySubject } from './email-parse';

/** One received email, already parsed, as queued through the shared webhook pipeline. */
export interface EmailInboundPayload {
  messageId: string;
  fromAddress: string;
  fromName?: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  sentAt: string;
}

/** Cursor into the mailbox, kept in the connection's metadata. */
export interface EmailSyncState {
  imapUidValidity: string;
  imapLastUid: number;
}

/**
 * Email over plain IMAP (receive) and SMTP (send) so any mailbox works without a vendor
 * account. Receiving is poll-based — see EmailSyncService in the worker — and every mail then
 * flows through the same idempotent ingest/queue path as a provider webhook. One conversation
 * per sender address; replies thread via In-Reply-To/References and "Re:" subjects.
 */
@Injectable()
export class EmailAdapter implements ChannelAdapter {
  readonly type = ChannelType.EMAIL;
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

  constructor(private readonly config: ConfigService) {}

  private get allowPrivate(): boolean {
    return this.config.get<boolean>('email.allowPrivateHosts') ?? false;
  }

  async connect(input: ConnectChannelInput): Promise<ConnectChannelResult> {
    const creds = parseEmailInput(input, this.allowPrivate);

    // Prove both directions work now, rather than failing silently on the first real mail.
    const state = await this.verifyImap(creds);
    await this.verifySmtp(creds);

    // Reconnecting the same mailbox keeps its place so mail that arrived while disconnected is
    // still picked up; a new/reset mailbox starts from "now" (no history import).
    const previous = input.previousMetadata as
      Partial<EmailSyncState> | undefined;
    const sameMailbox = input.previousExternalAccountId === creds.email;
    const keep =
      sameMailbox &&
      previous?.imapUidValidity === state.imapUidValidity &&
      typeof previous.imapLastUid === 'number'
        ? previous.imapLastUid
        : state.imapLastUid;

    return {
      externalAccountId: creds.email,
      externalAccountName: creds.fromName
        ? `${creds.fromName} <${creds.email}>`
        : creds.email,
      credentials: { ...creds },
      metadata: {
        email: creds.email,
        imapHost: creds.imapHost,
        smtpHost: creds.smtpHost,
        imapUidValidity: state.imapUidValidity,
        imapLastUid: keep,
      },
    };
  }

  private async verifyImap(creds: EmailCredentials): Promise<EmailSyncState> {
    let client;
    try {
      client = await createImapClient(creds, this.allowPrivate);
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const mailbox = client.mailbox;
        if (!mailbox) throw new Error('INBOX unavailable');
        return {
          imapUidValidity: String(mailbox.uidValidity),
          imapLastUid: Math.max(0, mailbox.uidNext - 1),
        };
      } finally {
        lock.release();
      }
    } catch (error) {
      throw describeMailError(error, 'IMAP', creds.imapHost);
    } finally {
      await client?.logout().catch(() => undefined);
    }
  }

  private async verifySmtp(creds: EmailCredentials): Promise<void> {
    try {
      const transport = await createSmtpTransport(creds, this.allowPrivate);
      try {
        await transport.verify();
      } finally {
        transport.close();
      }
    } catch (error) {
      throw describeMailError(error, 'SMTP', creds.smtpHost);
    }
  }

  async disconnect(_connection: ChannelConnection): Promise<void> {
    // Nothing provider-side: polling stops once the connection is no longer CONNECTED.
  }

  async sendMessage(
    connection: ChannelConnection,
    conversation: UnifiedConversation,
    message: OutboundMessage,
  ): Promise<SendMessageResult> {
    if (message.type !== MessageType.TEXT || !message.text) {
      throw new AppException(
        'UNSUPPORTED_MESSAGE_TYPE',
        'Email supports text replies only for now',
        HttpStatus.BAD_REQUEST,
      );
    }
    const creds = connection.credentials as unknown as EmailCredentials;
    if (!creds?.password) {
      throw new AppException(
        'CHANNEL_NOT_CONNECTED',
        'This mailbox is disconnected — reconnect it in Settings',
        HttpStatus.BAD_REQUEST,
      );
    }

    // The conversation id is the customer's address (see handleWebhook).
    const to =
      conversation.contactExternalId || conversation.externalConversationId;
    const inReplyTo = conversation.lastInboundExternalMessageId;

    const transport = await createSmtpTransport(creds, this.allowPrivate);
    try {
      const info = await transport.sendMail({
        from: creds.fromName
          ? { name: creds.fromName, address: creds.email }
          : creds.email,
        to,
        subject: replySubject(conversation.lastInboundSubject),
        text: message.text,
        ...(inReplyTo && { inReplyTo, references: [inReplyTo] }),
      });
      return {
        externalMessageId: info.messageId,
        status: MessageStatus.SENT,
      };
    } catch (error) {
      const e = error as { responseCode?: number; code?: string };
      // A 5xx is the server permanently refusing (bad recipient, auth, policy): retrying cannot
      // help, so surface it as terminal. Everything else (timeouts, 4xx) is left to retry.
      if (e.code === 'EAUTH' || (e.responseCode && e.responseCode >= 500)) {
        throw describeMailError(error, 'SMTP', creds.smtpHost);
      }
      throw error;
    } finally {
      transport.close();
    }
  }

  // Inbound mail is fetched by our own poller, never pushed to a public endpoint.
  verifySignature(): boolean {
    return false;
  }

  extractExternalAccountId(): string | null {
    return null;
  }

  extractEventKeys(payload: unknown): string[] {
    const p = payload as Partial<EmailInboundPayload>;
    return p?.messageId ? [`email:${p.messageId}`] : [];
  }

  async handleWebhook(
    payload: unknown,
    _connection: ChannelConnection,
  ): Promise<NormalizedWebhookEvent[]> {
    const p = payload as EmailInboundPayload;
    const address = p.fromAddress.toLowerCase();
    return [
      {
        kind: 'INBOUND_MESSAGE',
        externalConversationId: address,
        externalMessageId: p.messageId,
        contact: {
          externalUserId: address,
          username: address,
          displayName: p.fromName?.trim() || nameFromAddress(address),
        },
        messageType: MessageType.TEXT,
        content: p.text,
        messageMetadata: {
          subject: p.subject,
          ...(p.inReplyTo && { inReplyTo: p.inReplyTo }),
        },
        attachments: [],
        sentAt: new Date(p.sentAt),
        raw: p,
      },
    ];
  }
}
