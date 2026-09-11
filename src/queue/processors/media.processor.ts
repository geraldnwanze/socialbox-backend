import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { QueueName, MirrorMediaJob } from '../queue.constants';
import { MessageAttachment } from '../../messages/entities/message-attachment.entity';
import { StorageService } from '../../storage/storage.service';

/**
 * Provider-hosted media URLs (WhatsApp/Meta media links, Telegram file URLs) are often
 * short-lived or require the original access token to fetch — mirroring them into R2 keeps
 * attachments viewable indefinitely and independent of the provider's retention policy.
 */
@Processor(QueueName.MEDIA)
export class MediaProcessor extends WorkerHost {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    @InjectRepository(MessageAttachment)
    private readonly attachments: Repository<MessageAttachment>,
    private readonly storageService: StorageService,
  ) {
    super();
  }

  async process(job: Job<MirrorMediaJob>): Promise<void> {
    const attachment = await this.attachments.findOne({
      where: { id: job.data.attachmentId },
      relations: ['message'],
    });
    if (!attachment || attachment.storageKey || !attachment.sourceUrl) return;

    try {
      const storageKey = await this.storageService.mirrorFromUrl(
        attachment.message.workspaceId,
        attachment.sourceUrl,
        attachment.fileName ?? 'attachment',
        attachment.mimeType ?? 'application/octet-stream',
      );
      await this.attachments.update(attachment.id, { storageKey });
    } catch (error) {
      this.logger.warn(
        `Failed to mirror media for attachment ${attachment.id}: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
