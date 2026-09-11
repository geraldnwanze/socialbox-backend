import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttachmentsController } from './attachments.controller';
import { StorageModule } from '../storage/storage.module';
import { AccessControlModule } from '../common/access-control/access-control.module';
import { MessageAttachment } from '../messages/entities/message-attachment.entity';

@Module({
  imports: [
    StorageModule,
    AccessControlModule,
    TypeOrmModule.forFeature([MessageAttachment]),
  ],
  controllers: [AttachmentsController],
})
export class AttachmentsModule {}
