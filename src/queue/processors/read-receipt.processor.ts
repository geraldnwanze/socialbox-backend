import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { QueueName, SendReadReceiptJob } from '../queue.constants';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { Workspace } from '../../workspaces/entities/workspace.entity';
import { ChannelsService } from '../../channels/channels.service';
import { ChannelAdapterRegistry } from '../../channels/channel-adapter.registry';

/**
 * Tells the channel an agent has read the customer's messages: "seen" on WhatsApp/Messenger, the
 * \Seen flag on an email mailbox. Runs in the worker so a slow or failing provider never holds up
 * the agent opening the conversation, and BullMQ retries transient failures.
 */
@Processor(QueueName.READ_RECEIPTS)
export class ReadReceiptProcessor extends WorkerHost {
  private readonly logger = new Logger(ReadReceiptProcessor.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(Workspace)
    private readonly workspaces: Repository<Workspace>,
    private readonly channelsService: ChannelsService,
    private readonly registry: ChannelAdapterRegistry,
  ) {
    super();
  }

  async process(job: Job<SendReadReceiptJob>): Promise<void> {
    const { conversationId, externalMessageIds } = job.data;
    const conversation = await this.conversations.findOne({
      where: { id: conversationId },
    });
    if (!conversation || externalMessageIds.length === 0) return;

    const connection = await this.channelsService.loadWithCredentials(
      conversation.channelConnectionId,
    );
    const adapter = this.registry.find(connection.type);
    if (!adapter?.markAsRead || !adapter.capabilities.markAsRead) return;

    if (adapter.capabilities.markAsReadNotifiesCustomer) {
      // Checked here, not when enqueuing, so turning receipts off also stops jobs already queued.
      const workspace = await this.workspaces.findOne({
        where: { id: conversation.workspaceId },
      });
      if (!workspace?.sendReadReceipts) return;
    }

    await adapter.markAsRead(connection, {
      id: conversation.id,
      externalConversationId: conversation.externalConversationId,
      contactExternalId: '',
      lastInboundExternalMessageId:
        externalMessageIds[externalMessageIds.length - 1],
      readExternalMessageIds: externalMessageIds,
    });
    this.logger.debug(
      `Marked ${externalMessageIds.length} message(s) read on ${connection.type}`,
    );
  }
}
