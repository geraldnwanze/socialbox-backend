import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { IsNull, Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';
import { QueueName, NotificationJobName } from '../queue/queue.constants';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    @InjectQueue(QueueName.NOTIFICATIONS)
    private readonly notificationsQueue: Queue,
  ) {}

  async create(
    workspaceId: string,
    userId: string,
    type: NotificationType,
    payload: Record<string, unknown>,
  ) {
    const notification = await this.notifications.save(
      this.notifications.create({ workspaceId, userId, type, payload }),
    );
    // Delivery (realtime push now, email/push later) happens in the worker so a slow or
    // failing delivery channel never blocks the request that triggered the notification.
    await this.notificationsQueue.add(NotificationJobName.DISPATCH, {
      notificationId: notification.id,
    });
    return notification;
  }

  listForUser(workspaceId: string, userId: string) {
    return this.notifications.find({
      where: { workspaceId, userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async markRead(
    workspaceId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    await this.notifications.update(
      { id, workspaceId, userId },
      { readAt: new Date() },
    );
  }

  async markAllRead(workspaceId: string, userId: string): Promise<void> {
    await this.notifications.update(
      { workspaceId, userId, readAt: IsNull() },
      { readAt: new Date() },
    );
  }
}
