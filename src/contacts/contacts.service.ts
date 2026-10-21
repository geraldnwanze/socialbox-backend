import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Contact } from './entities/contact.entity';
import { ContactIdentity } from './entities/contact-identity.entity';
import { ChannelType } from '../channels/enums/channel-type.enum';
import { Conversation } from '../conversations/entities/conversation.entity';
import { UpdateContactDto } from './dto/update-contact.dto';
import {
  AppException,
  ResourceNotFoundException,
} from '../common/exceptions/app.exception';
import {
  PaginationQuery,
  paginateByCreatedAt,
} from '../common/pagination/cursor-pagination';

export interface InboundIdentity {
  workspaceId: string;
  channelConnectionId: string;
  channel: ChannelType;
  externalUserId: string;
  username?: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ContactsService {
  constructor(
    @InjectRepository(Contact) private readonly contacts: Repository<Contact>,
    @InjectRepository(ContactIdentity)
    private readonly identities: Repository<ContactIdentity>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /**
   * Idempotent find-or-create keyed on (channel_connection_id, external_user_id) — the same
   * inbound webhook retried never creates a duplicate contact. Deliberately does NOT try to
   * match this identity against contacts from other channels: cross-channel merging is a
   * conscious business-user action (see docs), never an automatic heuristic.
   */
  async findOrCreateFromIdentity(
    input: InboundIdentity,
  ): Promise<{ contact: Contact; identity: ContactIdentity }> {
    const existing = await this.identities.findOne({
      where: {
        channelConnectionId: input.channelConnectionId,
        externalUserId: input.externalUserId,
      },
      relations: ['contact'],
    });
    if (existing) {
      if (
        input.displayName &&
        existing.contact.displayName !== input.displayName
      ) {
        await this.contacts.update(existing.contact.id, {
          displayName: input.displayName,
        });
        existing.contact.displayName = input.displayName;
      }
      if (input.metadata) {
        const merged = { ...existing.metadata, ...input.metadata };
        if (JSON.stringify(merged) !== JSON.stringify(existing.metadata)) {
          await this.identities.update(existing.id, { metadata: merged });
          existing.metadata = merged;
        }
      }
      return { contact: existing.contact, identity: existing };
    }

    const contact = await this.contacts.save(
      this.contacts.create({
        workspaceId: input.workspaceId,
        displayName: input.displayName ?? input.username ?? 'Unknown',
      }),
    );
    try {
      const identity = await this.identities.save(
        this.identities.create({
          contactId: contact.id,
          workspaceId: input.workspaceId,
          channel: input.channel,
          channelConnectionId: input.channelConnectionId,
          externalUserId: input.externalUserId,
          username: input.username,
          displayName: input.displayName,
          metadata: input.metadata ?? {},
        }),
      );
      return { contact, identity };
    } catch (error) {
      // Two concurrent deliveries raced to create the same identity — the loser's own contact
      // row is an orphaned duplicate, so discard it and return the winner's instead.
      const winner = await this.identities.findOneOrFail({
        where: {
          channelConnectionId: input.channelConnectionId,
          externalUserId: input.externalUserId,
        },
        relations: ['contact'],
      });
      await this.contacts.delete(contact.id).catch(() => undefined);
      if ((error as { code?: string }).code !== '23505') throw error;
      return { contact: winner.contact, identity: winner };
    }
  }

  async findOneForWorkspace(workspaceId: string, id: string): Promise<Contact> {
    const contact = await this.contacts.findOne({
      where: { id, workspaceId },
      relations: ['identities'],
    });
    if (!contact) throw new ResourceNotFoundException('Contact');
    return contact;
  }

  async update(
    workspaceId: string,
    id: string,
    dto: UpdateContactDto,
  ): Promise<Contact> {
    const contact = await this.findOneForWorkspace(workspaceId, id);
    // A contact always needs something to be displayed as in the inbox.
    if (dto.displayName === null) {
      throw new AppException('INVALID_CONTACT', 'Name cannot be empty');
    }
    const patch: Record<string, string | null> = {};
    for (const key of ['displayName', 'email', 'phone', 'notes'] as const) {
      if (dto[key] !== undefined) patch[key] = dto[key];
    }
    if (Object.keys(patch).length === 0) return contact;
    await this.contacts.update(contact.id, patch);
    Object.assign(contact, patch);
    return contact;
  }

  async listConversations(workspaceId: string, contactId: string) {
    await this.findOneForWorkspace(workspaceId, contactId);
    return this.conversations.find({
      where: { workspaceId, contactId },
      relations: ['channelConnection'],
      order: { lastMessageAt: { direction: 'DESC', nulls: 'LAST' } },
    });
  }

  /**
   * Folds a duplicate contact (`sourceId`) into `targetId`: every channel identity and conversation
   * moves across, blanks on the target are filled from the source, notes are combined, and the
   * source is deleted. Deliberate admin action only — nothing merges automatically.
   */
  async merge(
    workspaceId: string,
    targetId: string,
    sourceId: string,
  ): Promise<Contact> {
    if (targetId === sourceId) {
      throw new AppException(
        'INVALID_MERGE',
        'Choose a different contact to merge in',
      );
    }
    await this.dataSource.transaction(async (manager) => {
      const [target, source] = await Promise.all([
        manager.findOne(Contact, { where: { id: targetId, workspaceId } }),
        manager.findOne(Contact, { where: { id: sourceId, workspaceId } }),
      ]);
      if (!target || !source) throw new ResourceNotFoundException('Contact');

      await manager.update(
        ContactIdentity,
        { contactId: source.id },
        {
          contactId: target.id,
        },
      );
      await manager.update(
        Conversation,
        { contactId: source.id },
        {
          contactId: target.id,
        },
      );

      const notes = [target.notes, source.notes].filter(Boolean).join('\n\n');
      await manager.update(Contact, target.id, {
        email: target.email ?? source.email,
        phone: target.phone ?? source.phone,
        avatarUrl: target.avatarUrl ?? source.avatarUrl,
        notes: notes || (null as never),
        metadata: { ...source.metadata, ...target.metadata },
      });
      await manager.delete(Contact, source.id);
    });
    return this.findOneForWorkspace(workspaceId, targetId);
  }

  async list(
    workspaceId: string,
    query: PaginationQuery & { search?: string },
  ) {
    const qb = this.contacts
      .createQueryBuilder('contact')
      .leftJoinAndSelect('contact.identities', 'identity')
      .where('contact.workspaceId = :workspaceId', { workspaceId });

    if (query.search) {
      qb.andWhere(
        '(contact.displayName ILIKE :search OR contact.email ILIKE :search OR contact.phone ILIKE :search OR identity.username ILIKE :search OR identity.externalUserId ILIKE :search)',
        { search: `%${query.search}%` },
      );
    }

    return paginateByCreatedAt(qb, 'contact', query);
  }
}
