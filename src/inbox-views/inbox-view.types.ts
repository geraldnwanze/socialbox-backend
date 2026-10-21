import { ConversationPriority } from '../conversations/enums/conversation-priority.enum';
import { ConversationStatus } from '../conversations/enums/conversation-status.enum';

/** The inbox filters a view remembers — the same ones GET /conversations understands. */
export interface InboxViewFilters {
  status?: ConversationStatus;
  channelConnectionId?: string;
  /** "me", "unassigned", or a workspace member id. */
  assignedTo?: string;
  unreadOnly?: boolean;
  search?: string;
  priority?: ConversationPriority;
  tagId?: string;
  sort?: 'newest' | 'oldest';
}
