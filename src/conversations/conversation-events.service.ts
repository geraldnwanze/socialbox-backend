import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConversationEvent,
  ConversationEventType,
} from './entities/conversation-event.entity';
import { RealtimeService } from '../realtime/realtime.service';
import { RealtimeEvent } from '../realtime/realtime.events';

export interface ConversationEventView {
  id: string;
  type: ConversationEventType;
  data: Record<string, unknown>;
  createdAt: Date;
  actor: { id: string; name: string } | null;
}

const LIST_LIMIT = 200;

@Injectable()
export class ConversationEventsService {
  constructor(
    @InjectRepository(ConversationEvent)
    private readonly events: Repository<ConversationEvent>,
    private readonly realtime: RealtimeService,
  ) {}

  async record(
    workspaceId: string,
    conversationId: string,
    type: ConversationEventType,
    actorMemberId: string | null,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    await this.events.save(
      this.events.create({
        workspaceId,
        conversationId,
        type,
        actorMemberId,
        data,
      }),
    );
    // Open timelines refetch; nothing else needs to know.
    this.realtime.toWorkspace(
      workspaceId,
      RealtimeEvent.CONVERSATION_ACTIVITY,
      {
        conversationId,
      },
    );
  }

  /** Oldest first, so the timeline reads top to bottom. */
  async list(
    workspaceId: string,
    conversationId: string,
  ): Promise<ConversationEventView[]> {
    const rows = await this.events.find({
      where: { workspaceId, conversationId },
      relations: ['actorMember', 'actorMember.user'],
      order: { createdAt: 'DESC' },
      take: LIST_LIMIT,
    });
    return rows.reverse().map((row) => ({
      id: row.id,
      type: row.type,
      data: row.data,
      createdAt: row.createdAt,
      actor: row.actorMember
        ? {
            id: row.actorMember.id,
            name: row.actorMember.user?.fullName ?? 'Former member',
          }
        : null,
    }));
  }
}
