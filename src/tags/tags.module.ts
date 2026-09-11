import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tag } from './entities/tag.entity';
import { ConversationTag } from './entities/conversation-tag.entity';
import { TagsService } from './tags.service';
import { TagsController } from './tags.controller';
import { AccessControlModule } from '../common/access-control/access-control.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Tag, ConversationTag]),
    AccessControlModule,
  ],
  controllers: [TagsController],
  providers: [TagsService],
  exports: [TagsService],
})
export class TagsModule {}
