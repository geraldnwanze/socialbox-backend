export enum RealtimeEvent {
  CONVERSATION_CREATED = 'conversation.created',
  CONVERSATION_UPDATED = 'conversation.updated',
  CONVERSATION_ASSIGNED = 'conversation.assigned',
  CONVERSATION_RESOLVED = 'conversation.resolved',
  MESSAGE_CREATED = 'message.created',
  MESSAGE_UPDATED = 'message.updated',
  MESSAGE_STATUS_CHANGED = 'message.status_changed',
  NOTIFICATION_CREATED = 'notification.created',
  CONVERSATION_TYPING = 'conversation.typing',
  CONVERSATION_PRESENCE = 'conversation.presence',
}

export const workspaceRoom = (workspaceId: string) =>
  `workspace:${workspaceId}`;
export const conversationRoom = (conversationId: string) =>
  `conversation:${conversationId}`;
export const userRoom = (userId: string) => `user:${userId}`;
