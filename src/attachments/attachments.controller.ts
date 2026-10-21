import {
  Controller,
  Get,
  Body,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { WorkspaceGuard } from '../common/guards/workspace.guard';
import {
  CurrentWorkspace,
  WorkspaceContext,
} from '../common/decorators/current-workspace.decorator';
import { MessageAttachment } from '../messages/entities/message-attachment.entity';

@Controller('attachments')
@UseGuards(JwtAuthGuard, WorkspaceGuard)
export class AttachmentsController {
  constructor(
    private readonly storageService: StorageService,
    @InjectRepository(MessageAttachment)
    private readonly attachments: Repository<MessageAttachment>,
  ) {}

  /** Client uploads directly to R2 with the returned signed URL, then references `storageKey`
   *  when sending the message — the file body never passes through our API process. */
  @Post('upload-url')
  async createUploadUrl(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Body() dto: CreateUploadUrlDto,
  ) {
    const storageKey = this.storageService.buildKey(
      workspace.workspaceId,
      dto.fileName,
    );
    const uploadUrl = await this.storageService.getSignedUploadUrl(
      storageKey,
      dto.mimeType,
    );
    return { storageKey, uploadUrl };
  }

  @Get(':id/download-url')
  async getDownloadUrl(
    @CurrentWorkspace() workspace: WorkspaceContext,
    @Param('id') id: string,
  ) {
    const attachment = await this.attachments
      .createQueryBuilder('attachment')
      .innerJoin('attachment.message', 'message')
      .where('attachment.id = :id', { id })
      .andWhere('message.workspaceId = :workspaceId', {
        workspaceId: workspace.workspaceId,
      })
      .getOne();
    if (!attachment?.storageKey)
      throw new NotFoundException('Attachment not available');

    return {
      url: await this.storageService.getSignedDownloadUrl(
        attachment.storageKey,
        900,
        attachment.fileName ?? 'attachment',
      ),
    };
  }
}
