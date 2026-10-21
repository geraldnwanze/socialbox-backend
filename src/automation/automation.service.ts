import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Redis } from 'ioredis';
import { In, Repository } from 'typeorm';
import { AutomationRule } from './entities/automation-rule.entity';
import {
  AutomationAction,
  AutomationCondition,
  MatchContext,
} from './automation.types';
import {
  MAX_RULES_PER_WORKSPACE,
  ValidationLookups,
  parseActions,
  parseConditions,
} from './automation.validation';
import {
  expandPlaceholders,
  pickLeastBusy,
  rulesMatch,
} from './automation.engine';
import { ConversationsService } from '../conversations/conversations.service';
import { ConversationEventsService } from '../conversations/conversation-events.service';
import { Conversation } from '../conversations/entities/conversation.entity';
import { ConversationStatus } from '../conversations/enums/conversation-status.enum';
import { MessagesService } from '../messages/messages.service';
import { MessageType } from '../messages/enums/message.enums';
import { TagsService } from '../tags/tags.service';
import { Tag } from '../tags/entities/tag.entity';
import { WorkspaceMember } from '../workspaces/entities/workspace-member.entity';
import { ChannelType } from '../channels/enums/channel-type.enum';
import { REDIS_CLIENT } from '../redis/redis.module';
import { ResourceNotFoundException } from '../common/exceptions/app.exception';
import {
  CreateAutomationRuleDto,
  UpdateAutomationRuleDto,
} from './dto/automation-rule.dto';
import { BadRequestException } from '@nestjs/common';

export interface InboundForAutomation {
  workspaceId: string;
  conversationId: string;
  channelConnectionId: string;
  channelType: ChannelType;
  text: string;
  isNewConversation: boolean;
  contactName?: string | null;
}

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    @InjectRepository(AutomationRule)
    private readonly rules: Repository<AutomationRule>,
    @InjectRepository(WorkspaceMember)
    private readonly members: Repository<WorkspaceMember>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    private readonly conversationsService: ConversationsService,
    private readonly events: ConversationEventsService,
    private readonly messagesService: MessagesService,
    private readonly tagsService: TagsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ---- management -------------------------------------------------------------------------

  list(workspaceId: string) {
    return this.rules.find({
      where: { workspaceId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
  }

  private lookups(workspaceId: string): ValidationLookups {
    return {
      existingMemberIds: async (ids) => {
        const rows = await this.members.find({
          where: { workspaceId, id: In(ids) },
          select: { id: true },
        });
        return new Set(rows.map((r) => r.id));
      },
      tagExists: (tagId) =>
        this.tags.exists({ where: { id: tagId, workspaceId } }),
    };
  }

  async create(
    workspaceId: string,
    dto: CreateAutomationRuleDto,
  ): Promise<AutomationRule> {
    if (
      (await this.rules.count({ where: { workspaceId } })) >=
      MAX_RULES_PER_WORKSPACE
    ) {
      throw new BadRequestException(
        `A workspace can have at most ${MAX_RULES_PER_WORKSPACE} rules`,
      );
    }
    const conditions = await parseConditions(dto.conditions);
    const actions = await parseActions(dto.actions, this.lookups(workspaceId));
    const last = await this.rules.findOne({
      where: { workspaceId },
      order: { position: 'DESC' },
    });
    return this.rules.save(
      this.rules.create({
        workspaceId,
        name: dto.name.trim(),
        enabled: dto.enabled ?? true,
        position: (last?.position ?? -1) + 1,
        conditions,
        actions,
      }),
    );
  }

  async update(
    workspaceId: string,
    id: string,
    dto: UpdateAutomationRuleDto,
  ): Promise<AutomationRule> {
    const rule = await this.rules.findOne({ where: { id, workspaceId } });
    if (!rule) throw new ResourceNotFoundException('Automation rule');
    if (dto.name !== undefined) rule.name = dto.name.trim();
    if (dto.enabled !== undefined) rule.enabled = dto.enabled;
    if (dto.conditions !== undefined)
      rule.conditions = await parseConditions(dto.conditions);
    if (dto.actions !== undefined) {
      rule.actions = await parseActions(dto.actions, this.lookups(workspaceId));
    }
    return this.rules.save(rule);
  }

  /**
   * Rules run in this order, so it matters (e.g. "mark spam resolved" before "send a welcome reply").
   * The request must list every rule exactly once — a partial list could silently interleave with
   * rules the sender never saw.
   */
  async reorder(workspaceId: string, ids: string[]): Promise<AutomationRule[]> {
    const current = await this.rules.find({
      where: { workspaceId },
      select: { id: true },
    });
    const known = new Set(current.map((r) => r.id));
    if (
      ids.length !== known.size ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !known.has(id))
    ) {
      throw new BadRequestException(
        'Send every rule exactly once to reorder them',
      );
    }
    await this.rules.manager.transaction(async (manager) => {
      for (const [position, id] of ids.entries()) {
        await manager.update(AutomationRule, { id, workspaceId }, { position });
      }
    });
    return this.list(workspaceId);
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const rule = await this.rules.findOne({ where: { id, workspaceId } });
    if (!rule) throw new ResourceNotFoundException('Automation rule');
    await this.rules.remove(rule);
  }

  // ---- execution --------------------------------------------------------------------------

  /**
   * Runs the workspace's enabled rules against one new customer message. Called from the worker
   * once the message is stored, so a rule can never lose or delay a customer's message — and an
   * error in a rule is logged, never thrown back into the message pipeline.
   */
  async run(input: InboundForAutomation): Promise<void> {
    try {
      const rules = await this.rules.find({
        where: { workspaceId: input.workspaceId, enabled: true },
        order: { position: 'ASC', createdAt: 'ASC' },
      });
      if (rules.length === 0) return;

      const conversation = await this.conversations.findOne({
        where: { id: input.conversationId, workspaceId: input.workspaceId },
        select: { id: true, assignedTo: true, status: true },
      });
      if (!conversation) return;

      let assigned = !!conversation.assignedTo;
      for (const rule of rules) {
        const ctx: MatchContext = {
          text: input.text,
          channelType: input.channelType,
          isNewConversation: input.isNewConversation,
          assigned,
          now: new Date(),
        };
        if (!rulesMatch(rule.conditions as AutomationCondition[], ctx))
          continue;

        for (const action of rule.actions as AutomationAction[]) {
          try {
            if (await this.runAction(action, rule, input, assigned)) {
              if (action.type === 'ASSIGN') assigned = true;
            }
          } catch (error) {
            this.logger.warn(
              `Rule "${rule.name}" action ${action.type} failed: ${(error as Error).message}`,
            );
          }
        }
        await this.rules.update(rule.id, {
          triggerCount: () => '"trigger_count" + 1',
          lastTriggeredAt: new Date(),
        });
      }
    } catch (error) {
      this.logger.error(`Automation run failed: ${(error as Error).message}`);
    }
  }

  /** Returns true when the action actually changed something. */
  private async runAction(
    action: AutomationAction,
    rule: AutomationRule,
    input: InboundForAutomation,
    alreadyAssigned: boolean,
  ): Promise<boolean> {
    const via = { via: 'automation', rule: rule.name };
    const { workspaceId, conversationId } = input;

    switch (action.type) {
      case 'ASSIGN': {
        if (alreadyAssigned) return false; // first rule to assign wins; never override an owner
        const memberId = await this.chooseAssignee(
          workspaceId,
          action.memberIds,
        );
        if (!memberId) return false;
        await this.conversationsService.assign(
          workspaceId,
          conversationId,
          memberId,
          null,
          via,
        );
        return true;
      }
      case 'ADD_TAG': {
        const { added, tagName } = await this.tagsService.attachToConversation(
          workspaceId,
          conversationId,
          action.tagId,
        );
        if (added) {
          await this.events.record(
            workspaceId,
            conversationId,
            'TAG_ADDED',
            null,
            {
              tagId: action.tagId,
              tagName,
              ...via,
            },
          );
        }
        return added;
      }
      case 'SET_PRIORITY':
        await this.conversationsService.setPriority(
          workspaceId,
          conversationId,
          action.priority,
          null,
          via,
        );
        return true;
      case 'RESOLVE':
        await this.conversationsService.resolve(
          workspaceId,
          conversationId,
          null,
          via,
        );
        return true;
      case 'AUTO_REPLY': {
        // One automatic reply per conversation per cooldown, so a chatty customer — or another
        // bot on the other end — can never start a reply loop.
        const fresh = await this.redis.set(
          `automation:reply:${rule.id}:${conversationId}`,
          '1',
          'EX',
          action.cooldownMinutes * 60,
          'NX',
        );
        if (!fresh) return false;
        await this.messagesService.createOutbound({
          workspaceId,
          conversationId,
          channelConnectionId: input.channelConnectionId,
          automation: { ruleId: rule.id, ruleName: rule.name },
          type: MessageType.TEXT,
          text: expandPlaceholders(action.text, {
            customerName: input.contactName,
          }),
        });
        return true;
      }
    }
  }

  /** The least busy of the chosen teammates (or of everyone, when none were chosen). */
  private async chooseAssignee(
    workspaceId: string,
    memberIds: string[],
  ): Promise<string | null> {
    const candidates = (
      await this.members.find({
        where: memberIds.length
          ? { workspaceId, id: In(memberIds) }
          : { workspaceId },
        select: { id: true },
      })
    ).map((m) => m.id);
    if (candidates.length === 0) return null;

    const rows: { assigned_to: string; count: string }[] =
      await this.conversations
        .createQueryBuilder('c')
        .select('c.assigned_to', 'assigned_to')
        .addSelect('COUNT(*)', 'count')
        .where('c.workspace_id = :workspaceId', { workspaceId })
        .andWhere('c.status != :resolved', {
          resolved: ConversationStatus.RESOLVED,
        })
        .andWhere('c.assigned_to IN (:...candidates)', { candidates })
        .groupBy('c.assigned_to')
        .getRawMany();
    return pickLeastBusy(
      candidates,
      new Map(rows.map((r) => [r.assigned_to, Number(r.count)])),
    );
  }
}
