import { BadRequestException } from '@nestjs/common';
import { ConversationPriority } from '../conversations/enums/conversation-priority.enum';
import { ConversationStatus } from '../conversations/enums/conversation-status.enum';
import { InboxViewFilters } from './inbox-view.types';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED = new Set([
  'status',
  'channelConnectionId',
  'assignedTo',
  'unreadOnly',
  'search',
  'priority',
  'tagId',
  'sort',
]);

export interface FilterLookups {
  channelConnectionExists(id: string): Promise<boolean>;
  memberExists(id: string): Promise<boolean>;
  tagExists(id: string): Promise<boolean>;
}

const bad = (message: string) => new BadRequestException(message);

/** Only known filters survive, each checked — a saved view can never carry junk or foreign ids. */
export async function parseFilters(
  raw: unknown,
  lookups: FilterLookups,
): Promise<InboxViewFilters> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw bad('Filters must be an object');
  }
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!ALLOWED.has(key)) throw bad(`Unknown filter "${key}"`);
  }
  const out: InboxViewFilters = {};

  if (input.status !== undefined) {
    if (
      !Object.values(ConversationStatus).includes(
        input.status as ConversationStatus,
      )
    ) {
      throw bad('Status must be OPEN, PENDING or RESOLVED');
    }
    out.status = input.status as ConversationStatus;
  }
  if (input.priority !== undefined) {
    if (
      !Object.values(ConversationPriority).includes(
        input.priority as ConversationPriority,
      )
    ) {
      throw bad('Invalid priority');
    }
    out.priority = input.priority as ConversationPriority;
  }
  if (input.sort !== undefined) {
    if (input.sort !== 'newest' && input.sort !== 'oldest')
      throw bad('Sort must be newest or oldest');
    out.sort = input.sort;
  }
  if (input.unreadOnly !== undefined) {
    if (typeof input.unreadOnly !== 'boolean')
      throw bad('unreadOnly must be true or false');
    if (input.unreadOnly) out.unreadOnly = true;
  }
  if (input.search !== undefined) {
    if (typeof input.search !== 'string' || input.search.length > 100)
      throw bad('Search is too long');
    if (input.search.trim()) out.search = input.search.trim();
  }
  if (input.channelConnectionId !== undefined) {
    const id = String(input.channelConnectionId);
    if (!UUID_RE.test(id) || !(await lookups.channelConnectionExists(id))) {
      throw bad('Pick a channel from this workspace');
    }
    out.channelConnectionId = id;
  }
  if (input.assignedTo !== undefined) {
    const v = String(input.assignedTo);
    if (v !== 'me' && v !== 'unassigned') {
      if (!UUID_RE.test(v) || !(await lookups.memberExists(v)))
        throw bad('Pick a teammate from this workspace');
    }
    out.assignedTo = v;
  }
  if (input.tagId !== undefined) {
    const id = String(input.tagId);
    if (!UUID_RE.test(id) || !(await lookups.tagExists(id)))
      throw bad('Pick a tag from this workspace');
    out.tagId = id;
  }
  return out;
}
