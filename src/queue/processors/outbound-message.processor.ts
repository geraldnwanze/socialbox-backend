import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { QueueName, SendOutboundMessageJob } from '../queue.constants';
import { Message } from '../../messages/entities/message.entity';
import { MessageDirection } from '../../messages/enums/message.enums';
import { Conversation } from '../../conversations/entities/conversation.entity';
import { MessagesService } from '../../messages/messages.service';
import { ChannelsService } from '../../channels/channels.service';
import { ChannelAdapterRegistry } from '../../channels/channel-adapter.registry';
import { StorageService } from '../../storage/storage.service';
import { AppException } from '../../common/exceptions/app.exception';
import { OutboundMessage } from '../../channels/interfaces/channel-adapter.interface';

@Processor(QueueName.OUTBOUND_MESSAGES)
export class OutboundMessageProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboundMessageProcessor.name);

  constructor(
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    private readonly messagesService: MessagesService,
    private readonly channelsService: ChannelsService,
    private readonly channelAdapterRegistry: ChannelAdapterRegistry,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<SendOutboundMessageJob>): Promise<void> {
    const message = await this.messages.findOne({
      where: { id: job.data.messageId },
      relations: ['attachments'],
    });
    if (!message) {
      this.logger.warn(
        `Outbound message ${job.data.messageId} no longer exists`,
      );
      return;
    }

    const conversation = await this.conversations.findOne({
      where: { id: message.conversationId },
    });
    if (!conversation) {
      await this.messagesService.markFailed(
        message.id,
        'Conversation no longer exists',
      );
      return;
    }

    await this.messagesService.markSending(message.id);

    try {
      const connection = await this.channelsService.loadWithCredentials(
        message.channelConnectionId,
      );
      const adapter = this.channelAdapterRegistry.get(connection.type);

      const outbound: OutboundMessage = {
        type: message.messageType,
        text: message.content ?? undefined,
      };
      const attachment = message.attachments?.[0];
      if (attachment?.storageKey) {
        outbound.attachment = {
          url: await this.storageService.getSignedDownloadUrl(
            attachment.storageKey,
          ),
          mimeType: attachment.mimeType ?? 'application/octet-stream',
          fileName: attachment.fileName,
        };
      }

      // Threading context for channels that reply *to* something (email: In-Reply-To + subject).
      const lastInbound = await this.messages.findOne({
        where: {
          conversationId: conversation.id,
          direction: MessageDirection.INBOUND,
        },
        order: { sentAt: 'DESC' },
      });
      const subject = lastInbound?.metadata?.subject;

      const result = await adapter.sendMessage(
        connection,
        {
          id: conversation.id,
          externalConversationId: conversation.externalConversationId,
          contactExternalId: '',
          lastInboundExternalMessageId: lastInbound?.externalMessageId,
          lastInboundSubject: typeof subject === 'string' ? subject : undefined,
        },
        outbound,
      );

      await this.messagesService.markSent(message.id, result.externalMessageId);
    } catch (error) {
      if (error instanceof AppException) {
        // The provider explicitly rejected this message (bad recipient, outside the messaging
        // window, invalid credentials, ...) — retrying with the same input would fail the same
        // way, so this is terminal rather than requeued.
        await this.messagesService.markFailed(message.id, error.message);
        return;
      }
      // Anything else (network blip, timeout) is treated as transient and left to BullMQ's
      // retry/backoff policy configured on the queue. Only mark the message FAILED once the
      // queue has actually given up, so the UI doesn't flicker to "failed" between retries.
      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade + 1 >= maxAttempts) {
        await this.messagesService.markFailed(
          message.id,
          'Delivery failed after multiple attempts',
        );
      }
      throw error;
    }
  }
}
