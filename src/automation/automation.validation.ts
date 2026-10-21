import { BadRequestException } from '@nestjs/common';
import { ChannelType } from '../channels/enums/channel-type.enum';
import { ConversationPriority } from '../conversations/enums/conversation-priority.enum';
import { parseHours } from '../channels/adapters/live-chat/live-chat-hours';
import { AutomationAction, AutomationCondition } from './automation.types';

export const MAX_RULES_PER_WORKSPACE = 50;
const MAX_CONDITIONS = 10;
const MAX_ACTIONS = 6;
const MAX_KEYWORDS = 20;
const MAX_KEYWORD_LENGTH = 60;
const MAX_REPLY_LENGTH = 2000;
const DEFAULT_COOLDOWN_MINUTES = 720; // one automatic reply per conversation per 12 hours
const MAX_COOLDOWN_MINUTES = 60 * 24 * 30;

export interface ValidationLookups {
  /** Which of these workspace member ids really belong to the workspace. */
  existingMemberIds(ids: string[]): Promise<Set<string>>;
  tagExists(tagId: string): Promise<boolean>;
}

const bad = (message: string) => new BadRequestException(message);
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export async function parseConditions(
  raw: unknown,
): Promise<AutomationCondition[]> {
  if (!Array.isArray(raw)) throw bad('Conditions must be a list');
  if (raw.length > MAX_CONDITIONS) throw bad('Too many conditions');
  const seen = new Set<string>();
  return raw.map((item): AutomationCondition => {
    if (!isObject(item) || typeof item.type !== 'string') {
      throw bad('Each condition needs a type');
    }
    if (seen.has(item.type))
      throw bad(`Use each condition only once (${item.type})`);
    seen.add(item.type);

    switch (item.type) {
      case 'CHANNEL': {
        const channels = Array.isArray(item.channels) ? item.channels : [];
        const valid = Object.values(ChannelType) as string[];
        if (
          channels.length === 0 ||
          channels.some((c) => !valid.includes(String(c)))
        ) {
          throw bad('Pick at least one valid channel');
        }
        return {
          type: 'CHANNEL',
          channels: [...new Set(channels)] as ChannelType[],
        };
      }
      case 'KEYWORDS': {
        const keywords = (Array.isArray(item.keywords) ? item.keywords : [])
          .map((k) => String(k).trim())
          .filter(Boolean);
        if (keywords.length === 0) throw bad('Add at least one keyword');
        if (keywords.length > MAX_KEYWORDS)
          throw bad(`At most ${MAX_KEYWORDS} keywords`);
        if (keywords.some((k) => k.length > MAX_KEYWORD_LENGTH)) {
          throw bad(`Keywords can be at most ${MAX_KEYWORD_LENGTH} characters`);
        }
        return { type: 'KEYWORDS', keywords: [...new Set(keywords)] };
      }
      case 'FIRST_MESSAGE':
        return { type: 'FIRST_MESSAGE' };
      case 'UNASSIGNED':
        return { type: 'UNASSIGNED' };
      case 'OUTSIDE_HOURS': {
        try {
          const hours = parseHours({
            ...(isObject(item.hours) ? item.hours : {}),
            enabled: true,
          });
          return { type: 'OUTSIDE_HOURS', hours };
        } catch (error) {
          throw bad((error as Error).message);
        }
      }
      default:
        throw bad(`Unknown condition "${item.type}"`);
    }
  });
}

export async function parseActions(
  raw: unknown,
  lookups: ValidationLookups,
): Promise<AutomationAction[]> {
  if (!Array.isArray(raw)) throw bad('Actions must be a list');
  if (raw.length === 0) throw bad('Add at least one action');
  if (raw.length > MAX_ACTIONS) throw bad('Too many actions');

  const actions: AutomationAction[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isObject(item) || typeof item.type !== 'string') {
      throw bad('Each action needs a type');
    }
    if (seen.has(item.type))
      throw bad(`Use each action only once (${item.type})`);
    seen.add(item.type);

    switch (item.type) {
      case 'ASSIGN': {
        const memberIds = [
          ...new Set(
            (Array.isArray(item.memberIds) ? item.memberIds : []).map(String),
          ),
        ];
        if (memberIds.length > 0) {
          const existing = await lookups.existingMemberIds(memberIds);
          if (memberIds.some((id) => !existing.has(id)))
            throw bad('Pick teammates from this workspace');
        }
        actions.push({ type: 'ASSIGN', memberIds });
        break;
      }
      case 'ADD_TAG': {
        const tagId = String(item.tagId ?? '');
        if (!tagId || !(await lookups.tagExists(tagId)))
          throw bad('Pick a tag from this workspace');
        actions.push({ type: 'ADD_TAG', tagId });
        break;
      }
      case 'SET_PRIORITY': {
        if (
          !Object.values(ConversationPriority).includes(
            item.priority as ConversationPriority,
          )
        ) {
          throw bad('Pick a valid priority');
        }
        actions.push({
          type: 'SET_PRIORITY',
          priority: item.priority as ConversationPriority,
        });
        break;
      }
      case 'AUTO_REPLY': {
        const text = typeof item.text === 'string' ? item.text.trim() : '';
        if (!text) throw bad('The automatic reply needs some text');
        if (text.length > MAX_REPLY_LENGTH)
          throw bad(`Replies can be at most ${MAX_REPLY_LENGTH} characters`);
        const cooldown =
          item.cooldownMinutes === undefined
            ? DEFAULT_COOLDOWN_MINUTES
            : Number(item.cooldownMinutes);
        if (
          !Number.isInteger(cooldown) ||
          cooldown < 1 ||
          cooldown > MAX_COOLDOWN_MINUTES
        ) {
          throw bad('The reply cooldown must be between 1 minute and 30 days');
        }
        actions.push({ type: 'AUTO_REPLY', text, cooldownMinutes: cooldown });
        break;
      }
      case 'RESOLVE':
        actions.push({ type: 'RESOLVE' });
        break;
      default:
        throw bad(`Unknown action "${item.type}"`);
    }
  }
  return actions;
}
