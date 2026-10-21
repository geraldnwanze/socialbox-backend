import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contact } from './entities/contact.entity';
import { ContactIdentity } from './entities/contact-identity.entity';
import { ChannelType } from '../channels/enums/channel-type.enum';
import { ResourceNotFoundException } from '../common/exceptions/app.exception';
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
