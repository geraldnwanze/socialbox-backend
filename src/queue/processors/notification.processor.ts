import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { QueueName, DispatchNotificationJob } from '../queue.constants';
import { Notification } from '../../notifications/entities/notification.entity';
import { RealtimeService } from '../../realtime/realtime.service';
import { RealtimeEvent } from '../../realtime/realtime.events';

/**
 * Delivers a notification that's already been persisted. Today that just means pushing it over
 * Socket.IO; this is the seam where email/push delivery would plug in later without touching
 * NotificationsService's write path.
 */
@Processor(QueueName.NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly realtimeService: RealtimeService,
  ) {
    super();
  }

  async process(job: Job<DispatchNotificationJob>): Promise<void> {
    const notification = await this.notifications.findOne({
      where: { id: job.data.notificationId },
    });
    if (!notification) return;
    this.realtimeService.toUser(
      notification.userId,
      RealtimeEvent.NOTIFICATION_CREATED,
      notification,
    );
  }
}
