import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from '../messages/entities/message.entity';
import {
  MessageDirection,
  MessageStatus,
} from '../messages/enums/message.enums';
import { QueueName, ReadReceiptJobName } from '../queue/queue.constants';
import { ConversationParticipant } from './entities/conversation-participant.entity';
import { ConversationAssignment } from './entities/conversation-assignment.entity';
import { ConversationStatus } from './enums/conversation-status.enum';
import { ContactIdentity } from '../contacts/entities/contact-identity.entity';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationType } from '../notifications/entities/notification.entity';
import { RealtimeEvent } from '../realtime/realtime.events';
import { ListConversationsDto } from './dto/list-conversations.dto';
import { paginateByColumn } from '../common/pagination/cursor-pagination';
import { ResourceNotFoundException } from '../common/exceptions/app.exception';

@Injectable()
export class ConversationsService {
  constructor(
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(ConversationParticipant)
    private readonly participants: Repository<ConversationParticipant>,
    @InjectRepository(ConversationAssignment)
    private readonly assignments: Repository<ConversationAssignment>,
    @InjectRepository(ContactIdentity)
    private readonly contactIdentities: Repository<ContactIdentity>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    @InjectQueue(QueueName.READ_RECEIPTS) private readonly readReceipts: Queue,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly realtimeService: RealtimeService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Idempotent find-or-create keyed on (channel_connection_id, external_conversation_id).
   * Safe to call for every inbound message, including retried webhook deliveries.
   */
  async findOrCreateForInbound(input: {
    workspaceId: string;
    channelConnectionId: string;
    externalConversationId: string;
    contactId: string;
    contactIdentityId: string;
    firstMessageAt: Date;
  }): Promise<{ conversation: Conversation; created: boolean }> {
    const existing = await this.conversations.findOne({
      where: {
        channelConnectionId: input.channelConnectionId,
        externalConversationId: input.externalConversationId,
      },
    });
    if (existing) return { conversation: existing, created: false };

    return this.dataSource.transaction(async (manager) => {
      const conversation = await manager.save(
        manager.create(Conversation, {
          workspaceId: input.workspaceId,
          channelConnectionId: input.channelConnectionId,
          externalConversationId: input.externalConversationId,
          contactId: input.contactId,
          status: ConversationStatus.OPEN,
          lastMessageAt: input.firstMessageAt,
          unreadCount: 0,
        }),
      );
      await manager
        .createQueryBuilder()
        .insert()
        .into(ConversationParticipant)
        .values({
          conversationId: conversation.id,
          contactIdentityId: input.contactIdentityId,
        })
        .orIgnore()
        .execute();
      return { conversation, created: true };
    });
  }

  async recordInboundMessage(
    conversationId: string,
    preview: string,
    sentAt: Date,
  ): Promise<Conversation> {
    await this.conversations
      .createQueryBuilder()
      .update(Conversation)
      .set({
        lastMessageAt: sentAt,
        lastMessagePreview: preview,
        unreadCount: () => '"unread_count" + 1',
        status: ConversationStatus.OPEN,
        resolvedAt: () => 'NULL',
      })
      .where('id = :id', { id: conversationId })
      .execute();
    const conversation = await this.conversations.findOneOrFail({
      where: { id: conversationId },
    });
    this.realtimeService.toWorkspace(
      conversation.workspaceId,
      RealtimeEvent.CONVERSATION_UPDATED,
      conversation,
    );
    this.realtimeService.toConversation(
      conversationId,
      RealtimeEvent.CONVERSATION_UPDATED,
      conversation,
    );
    return conversation;
  }

  async recordOutboundMessage(
    conversationId: string,
    preview: string,
    sentAt: Date,
  ): Promise<Conversation> {
    await this.conversations.update(conversationId, {
      lastMessageAt: sentAt,
      lastMessagePreview: preview,
    });
    const conversation = await this.conversations.findOneOrFail({
      where: { id: conversationId },
    });
    this.realtimeService.toWorkspace(
      conversation.workspaceId,
      RealtimeEvent.CONVERSATION_UPDATED,
      conversation,
    );
    return conversation;
  }

  async findOneForWorkspace(
    workspaceId: string,
    id: string,
  ): Promise<Conversation> {
    const conversation = await this.conversations.findOne({
      where: { id, workspaceId },
      relations: [
        'contact',
        'contact.identities',
        'channelConnection',
        'assignee',
        'assignee.user',
      ],
    });
    if (!conversation) throw new ResourceNotFoundException('Conversation');
    return conversation;
  }

  async list(
    workspaceId: string,
    workspaceMemberId: string,
    query: ListConversationsDto,
  ) {
    const qb = this.conversations
      .createQueryBuilder('conversation')
      .leftJoinAndSelect('conversation.contact', 'contact')
      .leftJoinAndSelect('conversation.channelConnection', 'channelConnection')
      .leftJoinAndSelect('conversation.assignee', 'assignee')
      .where('conversation.workspaceId = :workspaceId', { workspaceId });

    if (query.status)
      qb.andWhere('conversation.status = :status', { status: query.status });
    if (query.channelConnectionId) {
      qb.andWhere('conversation.channelConnectionId = :channelConnectionId', {
        channelConnectionId: query.channelConnectionId,
      });
    }
    if (query.assignedTo === 'me') {
      qb.andWhere('conversation.assignedTo = :memberId', {
        memberId: workspaceMemberId,
      });
    } else if (query.assignedTo === 'unassigned') {
      qb.andWhere('conversation.assignedTo IS NULL');
    } else if (query.assignedTo) {
      qb.andWhere('conversation.assignedTo = :memberId', {
        memberId: query.assignedTo,
      });
    }
    if (query.unreadOnly === 'true') {
      qb.andWhere('conversation.unreadCount > 0');
    }
    if (query.search) {
      qb.andWhere(
        '(contact.displayName ILIKE :search OR conversation.lastMessagePreview ILIKE :search)',
        {
          search: `%${query.search}%`,
        },
      );
    }

    return paginateByColumn(qb, 'conversation', 'lastMessageAt', query);
  }

  async assign(
    workspaceId: string,
    conversationId: string,
    assignedToMemberId: string | null,
    assignedByMemberId: string,
  ): Promise<Conversation> {
    const conversation = await this.findOneForWorkspace(
      workspaceId,
      conversationId,
    );
    conversation.assignedTo = assignedToMemberId ?? undefined;
    await this.conversations.save(conversation);
    await this.assignments.save(
      this.assignments.create({
        conversationId,
        assignedToId: assignedToMemberId ?? undefined,
        assignedById: assignedByMemberId,
      }),
    );

    this.realtimeService.toWorkspace(
      workspaceId,
      RealtimeEvent.CONVERSATION_ASSIGNED,
      conversation,
    );
    this.realtimeService.toConversation(
      conversationId,
      RealtimeEvent.CONVERSATION_ASSIGNED,
      conversation,
    );

    if (assignedToMemberId) {
      const member = await this.dataSource
        .getRepository(WorkspaceMember)
        .findOne({ where: { id: assignedToMemberId } });
      if (member) {
        await this.notificationsService.create(
          workspaceId,
          member.userId,
          NotificationType.CONVERSATION_ASSIGNED,
          {
            conversationId,
          },
        );
      }
    }

    return conversation;
  }

  async resolve(
    workspaceId: string,
    conversationId: string,
  ): Promise<Conversation> {
    return this.setStatus(
      workspaceId,
      conversationId,
      ConversationStatus.RESOLVED,
      RealtimeEvent.CONVERSATION_RESOLVED,
    );
  }

  /** Parks a conversation as "waiting" (on the customer or an internal follow-up). A new inbound
   *  message flips it back to OPEN automatically (see recordInboundMessage). */
  async markPending(
    workspaceId: string,
    conversationId: string,
  ): Promise<Conversation> {
    return this.setStatus(
      workspaceId,
      conversationId,
      ConversationStatus.PENDING,
      RealtimeEvent.CONVERSATION_UPDATED,
    );
  }

  async reopen(
    workspaceId: string,
    conversationId: string,
  ): Promise<Conversation> {
    return this.setStatus(
      workspaceId,
      conversationId,
      ConversationStatus.OPEN,
      RealtimeEvent.CONVERSATION_UPDATED,
    );
  }

  private async setStatus(
    workspaceId: string,
    conversationId: string,
    status: ConversationStatus,
    event: RealtimeEvent,
  ): Promise<Conversation> {
    const conversation = await this.findOneForWorkspace(
      workspaceId,
      conversationId,
    );
    conversation.status = status;
    conversation.resolvedAt =
      status === ConversationStatus.RESOLVED ? new Date() : null;
    await this.conversations.save(conversation);
    this.realtimeService.toWorkspace(workspaceId, event, conversation);
    this.realtimeService.toConversation(conversationId, event, conversation);
    return conversation;
  }

  async markRead(
    workspaceId: string,
    conversationId: string,
  ): Promise<Conversation> {
    const conversation = await this.findOneForWorkspace(
      workspaceId,
      conversationId,
    );
    conversation.unreadCount = 0;
    await this.conversations.save(conversation);

    // Every customer message up to now has been seen by an agent: record it, and let the channel
    // know (WhatsApp/Messenger "seen", email read flag) — once, not on every later visit.
    const newlyRead = await this.messages
      .createQueryBuilder()
      .update(Message)
      .set({ status: MessageStatus.READ })
      .where('conversation_id = :conversationId', { conversationId })
      .andWhere('direction = :direction', {
        direction: MessageDirection.INBOUND,
      })
      .andWhere('status = :status', { status: MessageStatus.RECEIVED })
      .returning('external_message_id, sent_at')
      .execute();
    const ids = (
      newlyRead.raw as { external_message_id: string | null; sent_at: Date }[]
    )
      .filter((row) => row.external_message_id)
      .sort((a, b) => +new Date(a.sent_at) - +new Date(b.sent_at))
      .map((row) => row.external_message_id as string);
    if (ids.length > 0) {
      await this.readReceipts.add(ReadReceiptJobName.SEND, {
        conversationId,
        externalMessageIds: ids,
      });
    }
    this.realtimeService.toWorkspace(
      workspaceId,
      RealtimeEvent.CONVERSATION_UPDATED,
      conversation,
    );
    return conversation;
  }

  async findContactIdentityForConversation(
    conversationId: string,
  ): Promise<ContactIdentity | null> {
    const participant = await this.participants.findOne({
      where: { conversationId },
      relations: ['contactIdentity'],
      order: { joinedAt: 'ASC' },
    });
    return participant?.contactIdentity ?? null;
  }
}
