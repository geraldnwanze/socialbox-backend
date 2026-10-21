import { ChannelType } from '../channels/enums/channel-type.enum';
import { ConversationPriority } from '../conversations/enums/conversation-priority.enum';
import { LiveChatHours } from '../channels/adapters/live-chat/live-chat-hours';

/** All conditions on a rule must hold ("AND"). */
export type AutomationCondition =
  | { type: 'CHANNEL'; channels: ChannelType[] }
  | { type: 'KEYWORDS'; keywords: string[] }
  | { type: 'FIRST_MESSAGE' }
  | { type: 'UNASSIGNED' }
  /** True when the message arrives *outside* these opening hours. */
  | { type: 'OUTSIDE_HOURS'; hours: LiveChatHours };

/** Actions run in order; one failing never stops the others. */
export type AutomationAction =
  /** No memberIds = anyone on the team. Picks whoever has the fewest open conversations. */
  | { type: 'ASSIGN'; memberIds: string[] }
  | { type: 'ADD_TAG'; tagId: string }
  | { type: 'SET_PRIORITY'; priority: ConversationPriority }
  | { type: 'AUTO_REPLY'; text: string; cooldownMinutes: number }
  | { type: 'RESOLVE' };

export interface MatchContext {
  text: string;
  channelType: ChannelType;
  isNewConversation: boolean;
  /** Whether the conversation already has an owner (including from an earlier rule in this run). */
  assigned: boolean;
  now: Date;
}
