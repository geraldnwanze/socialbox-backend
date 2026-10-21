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
    );

    await service.findOrCreateFromIdentity({
      ...base,
      metadata: { ip: '1.1.1.1' },
    });

    expect(identities.update).not.toHaveBeenCalled();
  });
});
