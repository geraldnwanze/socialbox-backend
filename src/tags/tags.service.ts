import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tag } from './entities/tag.entity';
import { ConversationTag } from './entities/conversation-tag.entity';
import { ResourceNotFoundException } from '../common/exceptions/app.exception';

@Injectable()
export class TagsService {
  constructor(
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @InjectRepository(ConversationTag)
    private readonly conversationTags: Repository<ConversationTag>,
  ) {}

  list(workspaceId: string) {
    return this.tags.find({ where: { workspaceId }, order: { name: 'ASC' } });
  }

  async create(
    workspaceId: string,
    name: string,
    color?: string,
  ): Promise<Tag> {
    const existing = await this.tags.findOne({ where: { workspaceId, name } });
    if (existing)
      throw new BadRequestException('A tag with this name already exists');
    return this.tags.save(
      this.tags.create({ workspaceId, name, color: color ?? '#6366F1' }),
    );
  }

  async update(
    workspaceId: string,
    id: string,
    changes: { name?: string; color?: string },
  ): Promise<Tag> {
    const tag = await this.tags.findOne({ where: { id, workspaceId } });
    if (!tag) throw new ResourceNotFoundException('Tag');
    Object.assign(tag, changes);
    return this.tags.save(tag);
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const tag = await this.tags.findOne({ where: { id, workspaceId } });
    if (!tag) throw new ResourceNotFoundException('Tag');
    await this.tags.remove(tag);
  }

  async attachToConversation(
    workspaceId: string,
    conversationId: string,
    tagId: string,
  ): Promise<void> {
    const tag = await this.tags.findOne({ where: { id: tagId, workspaceId } });
    if (!tag) throw new ResourceNotFoundException('Tag');

    const existing = await this.conversationTags.findOne({
      where: { conversationId, tagId },
    });
    if (existing) return;
    await this.conversationTags.save(
      this.conversationTags.create({ conversationId, tagId }),
    );
  }

  async detachFromConversation(
    conversationId: string,
    tagId: string,
  ): Promise<void> {
    await this.conversationTags.delete({ conversationId, tagId });
  }

  listForConversation(conversationId: string) {
    return this.conversationTags.find({
      where: { conversationId },
      relations: ['tag'],
    });
  }
}
