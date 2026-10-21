import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { simpleParser } from 'mailparser';
import { ChannelConnection } from '../channels/entities/channel-connection.entity';
import { ChannelType } from '../channels/enums/channel-type.enum';
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
import {
  htmlToText,
  isAutomatedMail,
  stripQuotedReply,
} from '../channels/adapters/email/email-parse';

/** Caps one poll so a huge backlog is worked through over several cycles, not one long stall. */
const MAX_PER_POLL = 50;
const MAX_BODY_CHARS = 20_000;

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
  ) {}

  async syncAll(): Promise<void> {
    const connections = await this.channelsService.listConnectedWithCredentials(
      ChannelType.EMAIL,
    );
    for (const connection of connections) {
      try {
        await this.syncConnection(connection);
      } catch (error) {
        await this.handleFailure(connection, error);
      }
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

  async syncConnection(connection: ChannelConnection): Promise<number> {
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
          const payload = await this.toPayload(source, creds, uid, validity);
          if (payload) {
            await this.webhooksService.ingest('email', connection.id, payload, [
              `email:${connection.id}:${payload.messageId}`,
            ]);
            ingested++;
          }
          await this.channelsService.mergeMetadata(connection.id, {
            imapLastUid: uid,
          });
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
  ): Promise<EmailInboundPayload | null> {
    const mail = await simpleParser(source);
    const from = mail.from?.value?.[0];
    const fromAddress = from?.address?.toLowerCase();
    if (!fromAddress || fromAddress === creds.email) return null;
    if (isAutomatedMail(mail.headers, fromAddress)) return null;

    const rawBody =
      mail.text?.trim() || (mail.html ? htmlToText(mail.html) : '');
    const body = stripQuotedReply(rawBody).slice(0, MAX_BODY_CHARS);

    return {
      messageId: mail.messageId ?? `uid-${validity}-${uid}`,
      fromAddress,
      fromName: from?.name || undefined,
      subject: (mail.subject ?? '').trim(),
      text: body || '(no text content)',
      inReplyTo: mail.inReplyTo || undefined,
      sentAt: (mail.date ?? new Date()).toISOString(),
    };
  }
}
