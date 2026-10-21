import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ImapFlow } from 'imapflow';
import { ChannelsService } from '../channels/channels.service';
import { ChannelType } from '../channels/enums/channel-type.enum';
import { EmailCredentials } from '../channels/adapters/email/email-config';
import { createImapClient } from '../channels/adapters/email/email-clients';
import { EmailSyncService } from './email-sync.service';

const RECONCILE_EVERY_MS = 30_000;
const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 5 * 60_000;

interface Watcher {
  /** `updatedAt` of the connection when started: a change (new password/server) restarts it. */
  stamp: number;
  stopped: boolean;
  client?: ImapFlow;
}

/**
 * Keeps one IMAP IDLE connection open per connected mailbox, so new mail is imported within a
 * second or two instead of waiting for the next poll. IDLE is only a wake-up signal: the actual
 * import is the same cursor-based sync the poller uses, so nothing can be missed or duplicated if
 * a connection drops or an event is lost — the slower poll remains as the safety net.
 */
@Injectable()
export class EmailIdleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailIdleService.name);
  private readonly watchers = new Map<string, Watcher>();
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly channelsService: ChannelsService,
    private readonly syncService: EmailSyncService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<boolean>('email.idleEnabled') === false) return;
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), RECONCILE_EVERY_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.all([...this.watchers.keys()].map((id) => this.stop(id)));
  }

  /** Starts watchers for new/changed mailboxes and stops those that were disconnected. */
  private async reconcile(): Promise<void> {
    try {
      const connected = await this.channelsService.listConnectedStamps(
        ChannelType.EMAIL,
      );
      const wanted = new Map(
        connected.map((c) => [c.id, new Date(c.updatedAt).getTime()]),
      );
      for (const id of [...this.watchers.keys()]) {
        const stamp = wanted.get(id);
        if (stamp === undefined || stamp !== this.watchers.get(id)?.stamp) {
          await this.stop(id);
        }
      }
      for (const [id, stamp] of wanted) {
        if (!this.watchers.has(id)) this.start(id, stamp);
      }
    } catch (error) {
      this.logger.warn(
        `Mail watcher reconcile failed: ${(error as Error).message}`,
      );
    }
  }

  private start(id: string, stamp: number): void {
    const watcher: Watcher = { stamp, stopped: false };
    this.watchers.set(id, watcher);
    void this.run(id, watcher);
  }

  private async stop(id: string): Promise<void> {
    const watcher = this.watchers.get(id);
    if (!watcher) return;
    watcher.stopped = true;
    this.watchers.delete(id);
    await watcher.client?.logout().catch(() => undefined);
  }

  private async run(id: string, watcher: Watcher): Promise<void> {
    let backoff = MIN_BACKOFF_MS;
    while (!watcher.stopped) {
      try {
        const connection = await this.channelsService.loadWithCredentials(id);
        const creds = connection.credentials as unknown as EmailCredentials;
        const allowPrivate =
          this.config.get<boolean>('email.allowPrivateHosts') ?? false;
        const client = await createImapClient(creds, allowPrivate);
        watcher.client = client;

        let pending: NodeJS.Timeout | undefined;
        client.on('exists', () => {
          // Coalesce bursts (a mail plus its flags) into one sync.
          clearTimeout(pending);
          pending = setTimeout(
            () => void this.syncService.syncById(id).catch(() => undefined),
            500,
          );
        });
        const closed = new Promise<void>((resolve) =>
          client.once('close', () => resolve()),
        );

        await client.connect();
        await client.mailboxOpen('INBOX'); // imapflow idles automatically from here
        backoff = MIN_BACKOFF_MS;
        // Catch up on anything that arrived while we were not watching.
        await this.syncService.syncById(id);
        await closed;
        clearTimeout(pending);
      } catch (error) {
        if (watcher.stopped) return;
        this.logger.debug(
          `IDLE watcher for ${id} failed: ${(error as Error).message}`,
        );
        if (
          (error as { authenticationFailed?: boolean }).authenticationFailed
        ) {
          // Same handling as the poller: mark the channel and let reconcile drop us.
          await this.syncService.syncById(id).catch(() => undefined);
        }
      } finally {
        await watcher.client?.logout().catch(() => undefined);
        watcher.client = undefined;
      }
      if (watcher.stopped) return;
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    }
  }
}
