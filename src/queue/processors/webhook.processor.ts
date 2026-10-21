import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { QueueName, ProcessWebhookEventJob } from '../queue.constants';
import {
  WebhookEvent,
  WebhookEventStatus,
} from '../../webhooks/entities/webhook-event.entity';
import { ChannelsService } from '../../channels/channels.service';
import { ChannelAdapterRegistry } from '../../channels/channel-adapter.registry';
import { ContactsService } from '../../contacts/contacts.service';
import { ConversationsService } from '../../conversations/conversations.service';
import { MessagesService } from '../../messages/messages.service';
import { AutomationService } from '../../automation/automation.service';

@Processor(QueueName.WEBHOOKS)
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookEvents: Repository<WebhookEvent>,
    private readonly channelsService: ChannelsService,
    private readonly channelAdapterRegistry: ChannelAdapterRegistry,
    private readonly contactsService: ContactsService,
    private readonly conversationsService: ConversationsService,
    private readonly messagesService: MessagesService,
    private readonly automationService: AutomationService,
  ) {
    super();
  }

  async process(job: Job<ProcessWebhookEventJob>): Promise<void> {
    const webhookEvent = await this.webhookEvents.findOne({
      where: { id: job.data.webhookEventId },
    });
    if (!webhookEvent) {
      this.logger.warn(
        `Webhook event ${job.data.webhookEventId} no longer exists`,
      );
      return;
    }
    if (webhookEvent.status === WebhookEventStatus.PROCESSED) {
      return; // already handled by a previous attempt of this same job
    }

    try {
      const connection = await this.channelsService.loadWithCredentials(
        webhookEvent.channelConnectionId!,
      );
      const adapter = this.channelAdapterRegistry.get(connection.type);
      const events = await adapter.handleWebhook(
        webhookEvent.rawPayload,
        connection,
      );

      for (const event of events) {
        if (event.kind === 'INBOUND_MESSAGE') {
          const { contact, identity } =
            await this.contactsService.findOrCreateFromIdentity({
              workspaceId: connection.workspaceId,
              channelConnectionId: connection.id,
              channel: connection.type,
              externalUserId: event.contact.externalUserId,
              username: event.contact.username,
              displayName: event.contact.displayName,
              fallbackDisplayName: event.contact.fallbackDisplayName,
              email: event.contact.email,
              metadata: event.contact.metadata,
            });

          const { conversation, created: isNewConversation } =
            await this.conversationsService.findOrCreateForInbound({
              workspaceId: connection.workspaceId,
              channelConnectionId: connection.id,
              externalConversationId: event.externalConversationId,
              contactId: contact.id,
              contactIdentityId: identity.id,
              firstMessageAt: event.sentAt,
            });

          const { created: isNewMessage } =
            await this.messagesService.createInbound({
              workspaceId: connection.workspaceId,
              conversationId: conversation.id,
              channelConnectionId: connection.id,
              externalMessageId: event.externalMessageId,
              senderExternalId: event.contact.externalUserId,
              messageType: event.messageType,
              content: event.content,
              metadata: event.messageMetadata,
              attachments: event.attachments,
              sentAt: event.sentAt,
            });

          // Only for a genuinely new message: a retried delivery must not run the rules twice.
          if (isNewMessage) {
            await this.automationService.run({
              workspaceId: connection.workspaceId,
              conversationId: conversation.id,
              channelConnectionId: connection.id,
              channelType: connection.type,
              text: event.content ?? '',
              isNewConversation,
              contactName: contact.displayName,
            });
          }
        } else if (event.kind === 'MESSAGE_STATUS') {
          await this.messagesService.applyStatusUpdate(
            connection.id,
            event.externalMessageId,
            event.status,
            event.failureReason,
          );
        }
      }

      await this.webhookEvents.update(webhookEvent.id, {
        status: WebhookEventStatus.PROCESSED,
        processedAt: new Date(),
      });
    } catch (error) {
      await this.webhookEvents.update(webhookEvent.id, {
        status: WebhookEventStatus.FAILED,
        errorMessage: (error as Error).message,
      });
      throw error; // let BullMQ retry with backoff
    }
  }
}
