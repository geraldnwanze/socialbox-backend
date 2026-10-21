import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Message } from './entities/message.entity';
import { MessageAttachment } from './entities/message-attachment.entity';
import {
  MessageDirection,
  MessageStatus,
  MessageType,
  SenderType,
} from './enums/message.enums';
import {
  QueueName,
  MediaJobName,
  OutboundMessageJobName,
} from '../queue/queue.constants';
import { RealtimeService } from '../realtime/realtime.service';
import { RealtimeEvent } from '../realtime/realtime.events';
import { ConversationsService } from '../conversations/conversations.service';
import { ResourceNotFoundException } from '../common/exceptions/app.exception';
import { InboundAttachment } from '../channels/interfaces/channel-adapter.interface';
import {
  PaginationQuery,
  paginateByCreatedAt,
} from '../common/pagination/cursor-pagination';

const STATUS_RANK: Record<MessageStatus, number> = {
  [MessageStatus.RECEIVED]: 0,
  [MessageStatus.QUEUED]: 0,
  [MessageStatus.SENDING]: 1,
  [MessageStatus.SENT]: 2,
  [MessageStatus.DELIVERED]: 3,
  [MessageStatus.READ]: 4,
  [MessageStatus.FAILED]: 5,
};

export interface CreateInboundMessageInput {
  workspaceId: string;
  conversationId: string;
  channelConnectionId: string;
  externalMessageId: string;
  senderExternalId: string;
  messageType: MessageType;
  content?: string;
  metadata?: Record<string, unknown>;
  attachments: InboundAttachment[];
  sentAt: Date;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(MessageAttachment)
    private readonly attachments: Repository<MessageAttachment>,
    @InjectQueue(QueueName.OUTBOUND_MESSAGES)
    private readonly outboundQueue: Queue,
    @InjectQueue(QueueName.MEDIA) private readonly mediaQueue: Queue,
    @Inject(forwardRef(() => ConversationsService))
    private readonly conversationsService: ConversationsService,
    private readonly realtimeService: RealtimeService,
  ) {}

  async listForConversation(
    workspaceId: string,
    conversationId: string,
    query: PaginationQuery,
  ) {
    const qb = this.messages
      .createQueryBuilder('message')
      .leftJoinAndSelect('message.attachments', 'attachments')
      .where('message.workspaceId = :workspaceId', { workspaceId })
      .andWhere('message.conversationId = :conversationId', { conversationId });
    return paginateByCreatedAt(qb, 'message', query);
  }

  /**
   * Idempotent insert keyed on (channel_connection_id, external_message_id): if the same
   * webhook is delivered N times, only the first insert succeeds and every later call is a
   * harmless no-op that returns the already-stored message with `created: false`.
   */
  async createInbound(
    input: CreateInboundMessageInput,
  ): Promise<{ message: Message; created: boolean }> {
    const insertResult = await this.messages
      .createQueryBuilder()
      .insert()
      .into(Message)
      .values({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        channelConnectionId: input.channelConnectionId,
        externalMessageId: input.externalMessageId,
        senderType: SenderType.CONTACT,
        senderExternalId: input.senderExternalId,
        direction: MessageDirection.INBOUND,
        messageType: input.messageType,
        content: input.content,
        status: MessageStatus.RECEIVED,
        sentAt: input.sentAt,
        metadata: input.metadata ?? {},
      })
      .orIgnore()
      .returning('id')
      .execute();

    const insertedId: string | undefined = insertResult.raw?.[0]?.id;
    if (!insertedId) {
      const existing = await this.messages.findOne({
        where: {
          channelConnectionId: input.channelConnectionId,
          externalMessageId: input.externalMessageId,
        },
      });
      return { message: existing!, created: false };
    }

    const message = await this.messages.findOneOrFail({
      where: { id: insertedId },
    });

    for (const attachment of input.attachments) {
      const saved = await this.attachments.save(
        this.attachments.create({
          messageId: message.id,
          mimeType: attachment.mimeType,
          fileName: attachment.fileName,
          sourceUrl: attachment.url,
          storageKey: attachment.storageKey,
          fileSize: attachment.size,
        }),
      );
      // Already-stored files (email) need no mirroring.
      if (!attachment.storageKey) {
        await this.mediaQueue.add(MediaJobName.MIRROR_TO_STORAGE, {
          attachmentId: saved.id,
        });
      }
    }

    await this.conversationsService.recordInboundMessage(
      input.conversationId,
      input.content ?? `[${input.messageType.toLowerCase()}]`,
      input.sentAt,
    );

    this.realtimeService.toWorkspace(
      input.workspaceId,
      RealtimeEvent.MESSAGE_CREATED,
      message,
    );
    this.realtimeService.toConversation(
      input.conversationId,
      RealtimeEvent.MESSAGE_CREATED,
      message,
    );

    return { message, created: true };
  }

  async createOutbound(input: {
    workspaceId: string;
    conversationId: string;
    channelConnectionId: string;
    senderMemberId: string;
    type: MessageType;
    text?: string;
    attachment?: { storageKey: string; mimeType: string; fileName?: string };
  }): Promise<Message> {
    const message = await this.messages.save(
      this.messages.create({
        workspaceId: input.workspaceId,
        conversationId: input.conversationId,
        channelConnectionId: input.channelConnectionId,
        senderType: SenderType.AGENT,
        senderMemberId: input.senderMemberId,
        direction: MessageDirection.OUTBOUND,
        messageType: input.type,
        content: input.text,
        status: MessageStatus.QUEUED,
        sentAt: new Date(),
      }),
    );

    if (input.attachment) {
      await this.attachments.save(
        this.attachments.create({
          messageId: message.id,
          storageKey: input.attachment.storageKey,
          mimeType: input.attachment.mimeType,
          fileName: input.attachment.fileName,
        }),
      );
    }

    await this.conversationsService.recordOutboundMessage(
      input.conversationId,
      input.text ?? `[${input.type.toLowerCase()}]`,
      message.sentAt,
    );

    this.realtimeService.toWorkspace(
      input.workspaceId,
      RealtimeEvent.MESSAGE_CREATED,
      message,
    );
    this.realtimeService.toConversation(
      input.conversationId,
      RealtimeEvent.MESSAGE_CREATED,
      message,
    );

    await this.outboundQueue.add(OutboundMessageJobName.SEND, {
      messageId: message.id,
    });

    return message;
  }

  async findById(id: string): Promise<Message> {
    const message = await this.messages.findOne({
      where: { id },
      relations: ['attachments'],
    });
    if (!message) throw new ResourceNotFoundException('Message');
    return message;
  }

  async retryFailed(workspaceId: string, messageId: string): Promise<Message> {
    const message = await this.messages.findOne({
      where: { id: messageId, workspaceId },
    });
    if (!message) throw new ResourceNotFoundException('Message');
    if (message.status !== MessageStatus.FAILED) return message;

    message.status = MessageStatus.QUEUED;
    message.failureReason = undefined;
    await this.messages.save(message);
    this.emitStatus(message);
    await this.outboundQueue.add(OutboundMessageJobName.SEND, {
      messageId: message.id,
    });
    return message;
  }

  async markSending(messageId: string): Promise<void> {
    await this.messages.update(messageId, { status: MessageStatus.SENDING });
    const message = await this.messages.findOne({ where: { id: messageId } });
    if (message) this.emitStatus(message);
  }

  async markSent(messageId: string, externalMessageId: string): Promise<void> {
    await this.messages.update(messageId, {
      status: MessageStatus.SENT,
      externalMessageId,
    });
    const message = await this.messages.findOne({ where: { id: messageId } });
    if (message) this.emitStatus(message);
  }

  async markFailed(messageId: string, reason: string): Promise<void> {
    await this.messages.update(messageId, {
      status: MessageStatus.FAILED,
      failureReason: reason,
    });
    const message = await this.messages.findOne({ where: { id: messageId } });
    if (message) this.emitStatus(message);
  }

  /** Applies a delivery/read status update from a provider, ignoring out-of-order regressions. */
  async applyStatusUpdate(
    channelConnectionId: string,
    externalMessageId: string,
    status: MessageStatus,
    failureReason?: string,
  ): Promise<void> {
    const message = await this.messages.findOne({
      where: { channelConnectionId, externalMessageId },
    });
    if (!message) {
      this.logger.warn(
        `Status update for unknown message ${externalMessageId} on ${channelConnectionId}`,
      );
      return;
    }
    if (STATUS_RANK[status] < STATUS_RANK[message.status]) return;

    message.status = status;
    if (failureReason) message.failureReason = failureReason;
    await this.messages.save(message);
    this.emitStatus(message);
  }

  private emitStatus(message: Message) {
    this.realtimeService.toWorkspace(
      message.workspaceId,
      RealtimeEvent.MESSAGE_STATUS_CHANGED,
      message,
    );
    this.realtimeService.toConversation(
      message.conversationId,
      RealtimeEvent.MESSAGE_STATUS_CHANGED,
      message,
    );
  }
}
