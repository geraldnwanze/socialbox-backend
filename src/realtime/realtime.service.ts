import { Inject, Injectable } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import {
  RealtimeEvent,
  conversationRoom,
  userRoom,
  workspaceRoom,
} from './realtime.events';

/**
 * The only way the rest of the app should emit realtime events. Events are published through
 * Redis rather than straight to the gateway, because inbound messages are processed in the
 * worker process, which has no Socket.IO server of its own — the API's server (via
 * RedisIoAdapter) picks the events up and delivers them to connected browsers.
 */
@Injectable()
export class RealtimeService {
  private readonly emitter: Emitter;

  constructor(@Inject(REDIS_CLIENT) redis: Redis) {
    this.emitter = new Emitter(redis);
  }

  toWorkspace(workspaceId: string, event: RealtimeEvent, payload: unknown) {
    this.emitter.to(workspaceRoom(workspaceId)).emit(event, payload);
  }

  toConversation(
    conversationId: string,
    event: RealtimeEvent,
    payload: unknown,
  ) {
    this.emitter.to(conversationRoom(conversationId)).emit(event, payload);
  }

  toUser(userId: string, event: RealtimeEvent, payload: unknown) {
    this.emitter.to(userRoom(userId)).emit(event, payload);
  }
}
