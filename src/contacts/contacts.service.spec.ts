import { ContactsService } from './contacts.service';
import { ChannelType } from '../channels/enums/channel-type.enum';

describe('ContactsService.findOrCreateFromIdentity metadata', () => {
  const base = {
    workspaceId: 'ws-1',
    channelConnectionId: 'conn-1',
    channel: ChannelType.LIVE_CHAT,
    externalUserId: 'visitor-1',
  };

  it('merges new metadata into an existing identity (latest page/IP wins, other keys kept)', async () => {
    const existing = {
      id: 'identity-1',
      metadata: {
        ip: '1.1.1.1',
        countryCode: 'AU',
        pageUrl: 'https://a.com/old',
      },
      contact: { id: 'c-1', displayName: 'Visitor' },
    };
    const identities = {
      findOne: jest.fn().mockResolvedValue(existing),
      update: jest.fn(),
    };
    const service = new ContactsService(
      { update: jest.fn() } as never,
      identities as never,
      {} as never,
      {} as never,
    );

    await service.findOrCreateFromIdentity({
      ...base,
      metadata: { pageUrl: 'https://a.com/new' },
    });

    expect(identities.update).toHaveBeenCalledWith('identity-1', {
      metadata: {
        ip: '1.1.1.1',
        countryCode: 'AU',
        pageUrl: 'https://a.com/new',
      },
    });
  });

  it('does not write when nothing changed', async () => {
    const existing = {
      id: 'identity-1',
      metadata: { ip: '1.1.1.1' },
      contact: { id: 'c-1' },
    };
    const identities = {
      findOne: jest.fn().mockResolvedValue(existing),
      update: jest.fn(),
    };
    const service = new ContactsService(
      { update: jest.fn() } as never,
      identities as never,
      {} as never,
      {} as never,
    );

    await service.findOrCreateFromIdentity({
      ...base,
      metadata: { ip: '1.1.1.1' },
    });

    expect(identities.update).not.toHaveBeenCalled();
  });
});

describe('ContactsService update/merge', () => {
  const contact = (over: object = {}) => ({
    id: 'c-1',
    workspaceId: 'ws-1',
    displayName: 'Ann',
    metadata: {},
    ...over,
  });

  function build(opts: { found?: Record<string, object | null> } = {}) {
    const contacts = {
      findOne: jest.fn().mockResolvedValue(contact()),
      update: jest.fn(),
    };
    const manager = {
      findOne: jest.fn((_e, q: { where: { id: string } }) =>
        Promise.resolve(opts.found?.[q.where.id] ?? null),
      ),
      update: jest.fn(),
      delete: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn((fn: (m: unknown) => unknown) => fn(manager)),
    };
    const service = new ContactsService(
      contacts as never,
      {} as never,
      {} as never,
      dataSource as never,
    );
    return { service, contacts, manager };
  }

  it('updates only the supplied fields and clears with null', async () => {
    const { service, contacts } = build();
    const result = await service.update('ws-1', 'c-1', {
      email: null,
      notes: 'VIP',
    });
    expect(contacts.update).toHaveBeenCalledWith('c-1', {
      email: null,
      notes: 'VIP',
    });
    expect(result.notes).toBe('VIP');
  });

  it('refuses to blank the name', async () => {
    const { service, contacts } = build();
    await expect(
      service.update('ws-1', 'c-1', { displayName: null }),
    ).rejects.toThrow('Name cannot be empty');
    expect(contacts.update).not.toHaveBeenCalled();
  });

  it('refuses to merge a contact into itself', async () => {
    const { service } = build();
    await expect(service.merge('ws-1', 'c-1', 'c-1')).rejects.toThrow(
      'different contact',
    );
  });

  it('404s when either contact is outside the workspace', async () => {
    const { service, manager } = build({ found: { 'c-1': contact() } });
    await expect(service.merge('ws-1', 'c-1', 'c-2')).rejects.toThrow(
      'Contact not found',
    );
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.delete).not.toHaveBeenCalled();
  });

  it('moves identities and conversations, fills blanks, joins notes and deletes the source', async () => {
    const target = contact({ id: 't', email: undefined, notes: 'A' });
    const source = contact({
      id: 's',
      email: 'x@y.com',
      phone: '1',
      notes: 'B',
    });
    const { service, manager } = build({ found: { t: target, s: source } });
    await service.merge('ws-1', 't', 's');

    const updates = manager.update.mock.calls.map((c) => [
      c[0].name,
      c[1],
      c[2],
    ]);
    expect(updates[0]).toEqual([
      'ContactIdentity',
      { contactId: 's' },
      { contactId: 't' },
    ]);
    expect(updates[1]).toEqual([
      'Conversation',
      { contactId: 's' },
      { contactId: 't' },
    ]);
    expect(updates[2][2]).toMatchObject({
      email: 'x@y.com',
      phone: '1',
      notes: 'A\n\nB',
    });
    expect(manager.delete).toHaveBeenCalledWith(expect.anything(), 's');
  });
});
