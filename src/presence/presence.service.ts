import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Redis } from 'ioredis';
import { Repository } from 'typeorm';
import { Conversation } from '../conversations/entities/conversation.entity';
import { User } from '../users/entities/user.entity';
import { REDIS_CLIENT } from '../redis/redis.module';
import { RealtimeService } from '../realtime/realtime.service';
import { RealtimeEvent } from '../realtime/realtime.events';
import { ResourceNotFoundException } from '../common/exceptions/app.exception';

/** Clients re-ping about every 15s while a conversation is open, so 30s tolerates a missed ping. */
export const VIEW_TTL_MS = 30_000;
export const TYPING_TTL_MS = 6_000;
const KEY_TTL_SECONDS = 120;

interface Entry {
  name: string;
  viewUntil: number;
  typeUntil: number;
}

export interface PresenceViewer {
  userId: string;
  name: string;
  typing: boolean;
  /** Epoch ms after which this person should be considered gone if no newer snapshot arrives. */
  until: number;
  typingUntil: number;
}

/**
 * Who has a conversation open, and who is typing in it — so two agents don't answer the same
 * customer at once (collision detection). State is a short-lived Redis hash per conversation;
 * every change is broadcast to the workspace as a full snapshot, and each viewer carries an expiry
 * so a closed tab disappears on its own even if it never says goodbye.
 */
@Injectable()
export class PresenceService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly realtime: RealtimeService,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  private key(conversationId: string) {
    return `presence:${conversationId}`;
  }

  private async assertInWorkspace(workspaceId: string, conversationId: string) {
    const exists = await this.conversations.exists({
      where: { id: conversationId, workspaceId },
    });
    if (!exists) throw new ResourceNotFoundException('Conversation');
  }

  /** "I have this conversation open" (and, with `typing`, "I am typing a reply"). */
  async touch(
    workspaceId: string,
    conversationId: string,
    userId: string,
    typing: boolean,
    now = Date.now(),
  ): Promise<PresenceViewer[]> {
    await this.assertInWorkspace(workspaceId, conversationId);
    const key = this.key(conversationId);
    const raw = await this.redis.hget(key, userId);
    const entry: Entry = raw
      ? (JSON.parse(raw) as Entry)
      : { name: await this.nameOf(userId), viewUntil: 0, typeUntil: 0 };
    entry.viewUntil = now + VIEW_TTL_MS;
    if (typing) entry.typeUntil = now + TYPING_TTL_MS;
    await this.redis.hset(key, userId, JSON.stringify(entry));
    await this.redis.expire(key, KEY_TTL_SECONDS);

    if (typing) {
      // Channels that can show it (live chat) tell the customer an agent is typing.
      await this.redis.set(`typing:agent:${conversationId}`, '1', 'EX', 6);
    }
    return this.publish(workspaceId, conversationId, now);
  }

  /** Closed the conversation: drop out immediately instead of waiting for the expiry. */
  async leave(
    workspaceId: string,
    conversationId: string,
    userId: string,
    now = Date.now(),
  ): Promise<void> {
    await this.assertInWorkspace(workspaceId, conversationId);
    await this.redis.hdel(this.key(conversationId), userId);
    await this.publish(workspaceId, conversationId, now);
  }

  private async nameOf(userId: string): Promise<string> {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, fullName: true },
    });
    return user?.fullName ?? 'A teammate';
  }

  private async publish(
    workspaceId: string,
    conversationId: string,
    now: number,
  ): Promise<PresenceViewer[]> {
    const viewers = await this.snapshot(conversationId, now);
    this.realtime.toWorkspace(
      workspaceId,
      RealtimeEvent.CONVERSATION_PRESENCE,
      {
        conversationId,
        viewers,
      },
    );
    return viewers;
  }

  /** Current viewers, pruning anyone whose expiry has passed. */
  async snapshot(
    conversationId: string,
    now = Date.now(),
  ): Promise<PresenceViewer[]> {
    const key = this.key(conversationId);
    const all = await this.redis.hgetall(key);
    const viewers: PresenceViewer[] = [];
    const stale: string[] = [];
    for (const [userId, raw] of Object.entries(all)) {
      const entry = JSON.parse(raw) as Entry;
      if (entry.viewUntil <= now) {
        stale.push(userId);
        continue;
      }
      viewers.push({
        userId,
        name: entry.name,
        typing: entry.typeUntil > now,
        until: entry.viewUntil,
        typingUntil: entry.typeUntil,
      });
    }
    if (stale.length) await this.redis.hdel(key, ...stale);
    return viewers.sort((a, b) => a.name.localeCompare(b.name));
  }
}
