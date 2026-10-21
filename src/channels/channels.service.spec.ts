import { ChannelsService } from './channels.service';
import { ChannelType } from './enums/channel-type.enum';

describe('ChannelsService.connect', () => {
  const connectResult = {
    externalAccountId: 'bot-1',
    externalAccountName: 'Bot',
    credentials: { botToken: 'secret' },
  };

  function build(configureWebhook: jest.Mock) {
    const connections = {
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ id: 'conn-1', ...v })),
      delete: jest.fn(),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const adapter = {
      constructor: { name: 'TelegramAdapter' },
      connect: jest.fn().mockResolvedValue(connectResult),
      configureWebhook,
    };
    const registry = { get: jest.fn().mockReturnValue(adapter) };
    const encryption = { encrypt: jest.fn().mockReturnValue('enc') };
    const service = new ChannelsService(
      connections as any,
      registry as any,
      encryption as any,
    );
    return { service, connections, adapter };
  }

  it('deletes the new connection and rethrows when webhook registration fails', async () => {
    const { service, connections } = build(
      jest.fn().mockRejectedValue(new Error('bad webhook')),
    );

    await expect(
      service.connect('ws-1', ChannelType.TELEGRAM, { botToken: 'x' }),
    ).rejects.toThrow('bad webhook');
    expect(connections.delete).toHaveBeenCalledWith('conn-1');
  });

  it('keeps the connection when webhook registration succeeds', async () => {
    const { service, connections } = build(
      jest.fn().mockResolvedValue(undefined),
    );

    const result = await service.connect('ws-1', ChannelType.TELEGRAM, {
      botToken: 'x',
    });

    expect(connections.delete).not.toHaveBeenCalled();
    expect(result.id).toBe('conn-1');
  });

  it('reuses an existing connection for the same external account instead of creating a duplicate', async () => {
    const { service, connections } = build(
      jest.fn().mockResolvedValue(undefined),
    );
    const existing = {
      id: 'conn-old',
      workspaceId: 'ws-1',
      type: ChannelType.TELEGRAM,
      externalAccountId: 'bot-1',
    };
    connections.findOne.mockResolvedValue(existing);

    const result = await service.connect('ws-1', ChannelType.TELEGRAM, {
      botToken: 'x',
    });

    expect(result.id).toBe('conn-old');
    expect(connections.create).not.toHaveBeenCalled();
    expect(connections.save).toHaveBeenCalledTimes(1);
  });
});
