import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Attachment, simpleParser } from 'mailparser';
import { ChannelConnection } from '../channels/entities/channel-connection.entity';
import {
  ChannelConnectionStatus,
  ChannelType,
} from '../channels/enums/channel-type.enum';
import { ChannelsService } from '../channels/channels.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { EmailCredentials } from '../channels/adapters/email/email-config';
import {
  createImapClient,
  describeMailError,
} from '../channels/adapters/email/email-clients';
import {
  EmailInboundPayload,
  EmailSyncState,
} from '../channels/adapters/email/email.adapter';
import { StorageService } from '../storage/storage.service';
import {
  htmlToText,
  isAutomatedMail,
  parseBounce,
  sanitizeEmailHtml,
  stripQuotedReply,
} from '../channels/adapters/email/email-parse';

/** Caps one poll so a huge backlog is worked through over several cycles, not one long stall. */
const MAX_PER_POLL = 50;
const MAX_BODY_CHARS = 20_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Reads new mail from each connected mailbox and feeds it into the normal webhook pipeline.
 * Progress is a per-mailbox cursor (UIDVALIDITY + last UID) in the connection metadata, advanced
 * only after a mail was handed to the pipeline — and the pipeline itself is idempotent on
 * Message-ID — so a crash can cause a retry but never a lost or duplicated message.
 */
@Injectable()
export class EmailSyncService {
  private readonly logger = new Logger(EmailSyncService.name);

  constructor(
    private readonly channelsService: ChannelsService,
    private readonly webhooksService: WebhooksService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  /** Per-mailbox queue so a poll and an IDLE-triggered sync never overlap in this process. */
  private readonly running = new Map<string, Promise<unknown>>();

  private exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.running.get(id) ?? Promise.resolve();
    const next = previous.then(fn, fn);
    const tail = next.catch(() => undefined);
    this.running.set(id, tail);
    void tail.then(() => {
      if (this.running.get(id) === tail) this.running.delete(id);
    });
    return next;
  }

  /** Re-reads the connection (fresh cursor and credentials) and syncs it; used by the IDLE watchers. */
  async syncById(connectionId: string): Promise<void> {
    await this.exclusive(connectionId, async () => {
      const connection =
        await this.channelsService.loadWithCredentials(connectionId);
      if (connection.status !== ChannelConnectionStatus.CONNECTED) return;
      try {
        await this.syncConnectionUnlocked(connection);
      } catch (error) {
        await this.handleFailure(connection, error);
      }
    });
  }

  async syncAll(): Promise<void> {
    const connections = await this.channelsService.listConnectedStamps(
      ChannelType.EMAIL,
    );
    for (const { id } of connections) {
      await this.syncById(id);
    }
  }

  private async handleFailure(connection: ChannelConnection, error: unknown) {
    const creds = connection.credentials as unknown as EmailCredentials;
    const friendly = describeMailError(error, 'IMAP', creds?.imapHost ?? '');
    const isAuth =
      (error as { authenticationFailed?: boolean }).authenticationFailed ||
      friendly.message.includes('sign-in was rejected');
    if (isAuth) {
      // Credentials stopped working (password changed, app password revoked): stop hammering
      // the server and tell the admin on the channel card.
      await this.channelsService.markError(connection.id, friendly.message);
      this.logger.warn(`Mailbox ${creds.email} rejected sign-in; marked ERROR`);
    } else {
      // Network blips and server hiccups resolve themselves on the next cycle.
      this.logger.warn(
        `Mail sync failed for ${creds?.email}: ${friendly.message}`,
      );
    }
  }

  private async syncConnectionUnlocked(
    connection: ChannelConnection,
  ): Promise<number> {
    const creds = connection.credentials as unknown as EmailCredentials;
    if (!creds?.password) return 0;
    const allowPrivate =
      this.config.get<boolean>('email.allowPrivateHosts') ?? false;

    const client = await createImapClient(creds, allowPrivate);
    let ingested = 0;
    try {
      await client.connect();
      const lock = await client.getMailboxLock('INBOX');
      try {
        const mailbox = client.mailbox;
        if (!mailbox) return 0;
        const validity = String(mailbox.uidValidity);
        const state = connection.metadata as Partial<EmailSyncState>;

        if (
          state.imapUidValidity !== validity ||
          state.imapLastUid === undefined
        ) {
          // The server renumbered the mailbox (or we have no cursor): old UIDs are meaningless.
          // Resume from "now" rather than re-importing the whole mailbox.
          await this.channelsService.mergeMetadata(connection.id, {
            imapUidValidity: validity,
            imapLastUid: Math.max(0, mailbox.uidNext - 1),
          });
          this.logger.warn(`Reset mail cursor for ${creds.email}`);
          return 0;
        }

        const lastUid = state.imapLastUid;
        if (mailbox.uidNext - 1 <= lastUid) return 0;

        const batch: { uid: number; source: Buffer }[] = [];
        for await (const msg of client.fetch(
          `${lastUid + 1}:*`,
          { uid: true, source: true },
          { uid: true },
        )) {
          // "n:*" always returns the newest message even when it is older than n.
          if (msg.uid > lastUid && msg.source) {
            batch.push({ uid: msg.uid, source: msg.source });
          }
          if (batch.length >= MAX_PER_POLL) break;
        }
        batch.sort((a, b) => a.uid - b.uid);

        for (const { uid, source } of batch) {
          const payload = await this.toPayload(
            source,
            creds,
            uid,
            validity,
            connection.workspaceId,
          );
          if (payload) {
            await this.webhooksService.ingest('email', connection.id, payload, [
              `email:${connection.id}:${payload.messageId}`,
            ]);
            ingested++;
          }
          await this.channelsService.advanceImapCursor(connection.id, uid);
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => undefined);
    }
    if (ingested > 0) {
      this.logger.log(`Imported ${ingested} email(s) for ${creds.email}`);
    }
    return ingested;
  }

  /** Null for mail we deliberately skip (automated, from ourselves, no sender). */
  private async toPayload(
    source: Buffer,
    creds: EmailCredentials,
    uid: number,
    validity: string,
    workspaceId: string,
  ): Promise<EmailInboundPayload | null> {
    const mail = await simpleParser(source);
    const from = mail.from?.value?.[0];
    const fromAddress = from?.address?.toLowerCase();
    if (!fromAddress || fromAddress === creds.email) return null;

    // A failure report for one of our replies becomes a status update on that reply — checked
    // first, because it would otherwise be dropped as automated mail.
    const bounce = parseBounce(mail, source);
    if (bounce) {
      return {
        messageId: mail.messageId ?? `uid-${validity}-${uid}`,
        fromAddress,
        subject: (mail.subject ?? '').trim(),
        text: '',
        sentAt: (mail.date ?? new Date()).toISOString(),
        bounceFor: bounce.messageId,
        failureReason: bounce.reason,
      };
    }
    if (isAutomatedMail(mail.headers, fromAddress)) return null;

    const rawBody =
      mail.text?.trim() || (mail.html ? htmlToText(mail.html) : '');
    let body = stripQuotedReply(rawBody).slice(0, MAX_BODY_CHARS);
    const html = mail.html ? sanitizeEmailHtml(mail.html) : null;

    const { stored, notes } = await this.storeAttachments(
      mail.attachments,
      workspaceId,
    );
    if (notes.length) body = `${body}\n\n${notes.join('\n')}`.trim();

    return {
      messageId: mail.messageId ?? `uid-${validity}-${uid}`,
      fromAddress,
      fromName: from?.name || undefined,
      subject: (mail.subject ?? '').trim(),
      text: body || (stored.length ? '' : '(no text content)'),
      ...(html && { html }),
      ...(stored.length && { attachments: stored }),
      inReplyTo: mail.inReplyTo || undefined,
      sentAt: (mail.date ?? new Date()).toISOString(),
    };
  }

  /**
   * Saves a mail's real attachments (not inline signature images) to storage so they outlive the
   * mailbox and can be downloaded from the inbox. A file that can't be stored never blocks the
   * mail itself: it is mentioned in the message text instead.
   */
  private async storeAttachments(
    attachments: Attachment[] | undefined,
    workspaceId: string,
  ): Promise<{
    stored: NonNullable<EmailInboundPayload['attachments']>;
    notes: string[];
  }> {
    const stored: NonNullable<EmailInboundPayload['attachments']> = [];
    const notes: string[] = [];
    let total = 0;

    const real = (attachments ?? []).filter(
      (a) => !(a.contentDisposition === 'inline' && a.related),
    );
    for (const attachment of real) {
      const name = attachment.filename ?? 'attachment';
      if (stored.length >= MAX_ATTACHMENTS) {
        notes.push(`[Attachment skipped: ${name} (too many attachments)]`);
        continue;
      }
      if (
        attachment.size > MAX_ATTACHMENT_BYTES ||
        total + attachment.size > MAX_TOTAL_ATTACHMENT_BYTES
      ) {
        notes.push(`[Attachment skipped: ${name} (too large)]`);
        continue;
      }
      try {
        const key = this.storage.buildKey(workspaceId, name);
        await this.storage.upload(
          key,
          attachment.content,
          attachment.contentType,
        );
        total += attachment.size;
        stored.push({
          storageKey: key,
          mimeType: attachment.contentType,
          fileName: attachment.filename,
          size: attachment.size,
        });
      } catch (error) {
        this.logger.warn(
          `Could not store attachment "${name}": ${(error as Error).message}`,
        );
        notes.push(`[Attachment could not be saved: ${name}]`);
      }
    }
    return { stored, notes };
  }
}
