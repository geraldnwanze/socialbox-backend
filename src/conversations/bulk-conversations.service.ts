import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConversationsService } from './conversations.service';
import { ConversationEventsService } from './conversation-events.service';
import { ConversationPriority } from './enums/conversation-priority.enum';
import { TagsService } from '../tags/tags.service';
import { Tag } from '../tags/entities/tag.entity';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';

export interface BulkResult {
  updated: number;
  failed: { id: string; reason: string }[];
}

type Action =
  | { type: 'RESOLVE' | 'REOPEN' | 'PENDING' | 'MARK_READ' }
  | { type: 'ASSIGN'; memberId: string | null }
  | { type: 'PRIORITY'; priority: ConversationPriority }
  | { type: 'ADD_TAG' | 'REMOVE_TAG'; tagId: string };

const SIMPLE = ['RESOLVE', 'REOPEN', 'PENDING', 'MARK_READ'];

/**
 * Applies one action to many conversations by calling the same single-conversation methods the UI
 * uses, so every rule holds (workspace scoping, activity log, realtime events, notifications).
 * Conversations are handled one at a time and failures are reported per conversation instead of
 * aborting the batch.
 */
@Injectable()
export class BulkConversationsService {
  private readonly logger = new Logger(BulkConversationsService.name);

  constructor(
    private readonly conversations: ConversationsService,
    private readonly tags: TagsService,
    private readonly events: ConversationEventsService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Checks the action and anything it points at, once, before touching any conversation. */
  private async parse(
    workspaceId: string,
    raw: Record<string, unknown>,
  ): Promise<Action> {
    const type = String(raw.type);
    if (SIMPLE.includes(type)) return { type } as Action;

    if (type === 'ASSIGN') {
      if (raw.memberId === null || raw.memberId === undefined)
        return { type, memberId: null };
      const exists = await this.dataSource
        .getRepository(WorkspaceMember)
        .exists({ where: { id: String(raw.memberId), workspaceId } });
      if (!exists)
        throw new BadRequestException('Pick a teammate from this workspace');
      return { type, memberId: String(raw.memberId) };
    }
    if (type === 'PRIORITY') {
      if (
        !Object.values(ConversationPriority).includes(
          raw.priority as ConversationPriority,
        )
      ) {
        throw new BadRequestException('Pick a valid priority');
      }
      return { type, priority: raw.priority as ConversationPriority };
    }
    if (type === 'ADD_TAG' || type === 'REMOVE_TAG') {
      const tagId = String(raw.tagId ?? '');
      const exists = await this.dataSource
        .getRepository(Tag)
        .exists({ where: { id: tagId, workspaceId } });
      if (!exists)
        throw new BadRequestException('Pick a tag from this workspace');
      return { type, tagId };
    }
    throw new BadRequestException(`Unknown action "${type}"`);
  }

  async run(
    workspaceId: string,
    actorMemberId: string,
    ids: string[],
    rawAction: Record<string, unknown>,
  ): Promise<BulkResult> {
    const action = await this.parse(workspaceId, rawAction);
    const result: BulkResult = { updated: 0, failed: [] };

    for (const id of [...new Set(ids)]) {
      try {
        await this.apply(workspaceId, actorMemberId, id, action);
        result.updated++;
      } catch (error) {
        const reason =
          (error as { status?: number }).status === 404
            ? 'Conversation not found'
            : (error as Error).message;
        this.logger.debug(`Bulk ${action.type} failed for ${id}: ${reason}`);
        result.failed.push({ id, reason });
      }
    }
    return result;
  }

  private async apply(
    workspaceId: string,
    actor: string,
    id: string,
    action: Action,
  ) {
    switch (action.type) {
      case 'RESOLVE':
        await this.conversations.resolve(workspaceId, id, actor);
        return;
      case 'REOPEN':
        await this.conversations.reopen(workspaceId, id, actor);
        return;
      case 'PENDING':
        await this.conversations.markPending(workspaceId, id, actor);
        return;
      case 'MARK_READ':
        await this.conversations.markRead(workspaceId, id);
        return;
      case 'ASSIGN':
        await this.conversations.assign(
          workspaceId,
          id,
          action.memberId,
          actor,
        );
        return;
      case 'PRIORITY':
        await this.conversations.setPriority(
          workspaceId,
          id,
          action.priority,
          actor,
        );
        return;
      case 'ADD_TAG': {
        // Scoping check first: tags attach by id, so the conversation must be proven ours.
        await this.conversations.findOneForWorkspace(workspaceId, id);
        const { added, tagName } = await this.tags.attachToConversation(
          workspaceId,
          id,
          action.tagId,
        );
        if (added) {
          await this.events.record(workspaceId, id, 'TAG_ADDED', actor, {
            tagId: action.tagId,
            tagName,
          });
        }
        return;
      }
      case 'REMOVE_TAG': {
        await this.conversations.findOneForWorkspace(workspaceId, id);
        const { removed, tagName } = await this.tags.detachFromConversation(
          id,
          action.tagId,
        );
        if (removed) {
          await this.events.record(workspaceId, id, 'TAG_REMOVED', actor, {
            tagId: action.tagId,
            tagName,
          });
        }
        return;
      }
    }
  }
}
