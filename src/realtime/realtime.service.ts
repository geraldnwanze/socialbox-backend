import { Injectable } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import {
  RealtimeEvent,
  conversationRoom,
  userRoom,
  workspaceRoom,
} from './realtime.events';

/**
 * The only way the rest of the app should emit realtime events — keeps Socket.IO specifics
 * (room naming, the gateway's server instance) out of domain services.
 */
@Injectable()
export class RealtimeService {
  constructor(private readonly gateway: RealtimeGateway) {}

  toWorkspace(workspaceId: string, event: RealtimeEvent, payload: unknown) {
    this.gateway.server?.to(workspaceRoom(workspaceId)).emit(event, payload);
  }

  toConversation(
    conversationId: string,
    event: RealtimeEvent,
    payload: unknown,
  ) {
    this.gateway.server
      ?.to(conversationRoom(conversationId))
      .emit(event, payload);
  }

  toUser(userId: string, event: RealtimeEvent, payload: unknown) {
    this.gateway.server?.to(userRoom(userId)).emit(event, payload);
  }
}
