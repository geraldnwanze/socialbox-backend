import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { WidgetService } from './widget.service';

describe('WidgetService', () => {
  const connection = (allowedOrigins: string[]) => ({
    id: 'conn-1',
    metadata: {
      title: 'Chat',
      greeting: 'Hi',
      color: '#4F46E5',
      allowedOrigins,
    },
  });

  function build(conn: unknown, webhooks = { ingest: jest.fn() }) {
    const connections = { findOne: jest.fn().mockResolvedValue(conn) };
    const config = { get: jest.fn().mockReturnValue('test-secret') };
    const service = new WidgetService(
      connections as never,
      {} as never,
      {} as never,
      new JwtService({}),
      config as never,
      webhooks as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, connections, webhooks };
  }

  it('blocks a site that is not in the allowed origins list', async () => {
    const { service } = build(connection(['https://shop.example.com']));
    await expect(
      service.getConfig('wk_1', 'https://evil.example.com'),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.getConfig('wk_1', undefined)).rejects.toThrow(
      ForbiddenException,
    );
    await expect(
      service.getConfig('wk_1', 'https://shop.example.com'),
    ).resolves.toMatchObject({
      title: 'Chat',
    });
  });

  it('allows any site when no origins are configured', async () => {
    const { service } = build(connection([]));
    await expect(
      service.getConfig('wk_1', 'https://anything.test'),
    ).resolves.toBeDefined();
  });

  it('returns 404 for an unknown or disconnected widget key', async () => {
    const { service } = build(null);
    await expect(service.getConfig('wk_missing')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('round-trips a visitor token and rejects tampered or wrong-type tokens', async () => {
    const { service } = build(connection([]));
    const { token, visitorId } = await service.createSession('wk_1');

    const session = await service.authenticate(token);
    expect(session.visitorId).toBe(visitorId);

    await expect(service.authenticate(token + 'x')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.authenticate(undefined)).rejects.toThrow(
      UnauthorizedException,
    );

    const userToken = await new JwtService({}).signAsync(
      { sub: 'user-1', type: 'access' },
      { secret: 'test-secret' },
    );
    await expect(service.authenticate(userToken)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('queues visitor messages through the idempotent webhook ingest, with visitor details and a sanitized page URL', async () => {
    const { service, webhooks } = build(connection([]));
    const session = { visitorId: 'v-1', connection: connection([]) as never };

    await service.sendMessage(
      session,
      {
        id: 'client-msg-1',
        text: '  hello  ',
        pageUrl: 'https://shop.example.com/cart?x=1#frag',
      },
      { ip: '8.8.8.8', countryCode: 'US' },
    );

    expect(webhooks.ingest).toHaveBeenCalledWith(
      'livechat',
      'conn-1',
      {
        visitorId: 'v-1',
        messageId: 'client-msg-1',
        text: 'hello',
        visitor: {
          ip: '8.8.8.8',
          countryCode: 'US',
          pageUrl: 'https://shop.example.com/cart?x=1',
        },
      },
      ['livechat:client-msg-1'],
    );
  });

  it('drops a page URL that is not http(s) instead of storing it', async () => {
    const { service, webhooks } = build(connection([]));
    const session = { visitorId: 'v-1', connection: connection([]) as never };

    await service.sendMessage(session, {
      id: 'client-msg-2',
      text: 'hi',
      pageUrl: 'javascript:alert(1)',
    });

    expect(webhooks.ingest.mock.calls[0][2].visitor.pageUrl).toBeUndefined();
  });

  describe('delivery and read status', () => {
    const session = {
      visitorId: 'v1',
      connection: { id: 'conn-1', workspaceId: 'w1', metadata: {} },
    } as never;

    function buildStatus(rows: object[], sendReadReceipts = true) {
      const update = jest.fn();
      const realtime = { toWorkspace: jest.fn(), toConversation: jest.fn() };
      const service = new WidgetService(
        {} as never,
        { findOne: jest.fn().mockResolvedValue({ id: 'c1' }) } as never,
        { find: jest.fn().mockResolvedValue(rows), update } as never,
        new JwtService({}),
        { get: jest.fn() } as never,
        {} as never,
        { getSignedDownloadUrl: jest.fn() } as never,
        realtime as never,
        {} as never,
        { findOne: jest.fn().mockResolvedValue({ sendReadReceipts }) } as never,
      );
      return { service, update, realtime };
    }
    const agentMsg = (status: string) => ({
      id: 'a1',
      workspaceId: 'w1',
      conversationId: 'c1',
      direction: 'OUTBOUND',
      status,
      attachments: [],
    });

    it('marks agent messages DELIVERED when the widget fetches them, and tells the agents', async () => {
      const { service, update, realtime } = buildStatus([agentMsg('SENT')]);
      await service.listMessages(session);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ id: expect.anything() }),
        { status: 'DELIVERED' },
      );
      expect(realtime.toWorkspace).toHaveBeenCalledWith(
        'w1',
        'message.status_changed',
        expect.objectContaining({ status: 'DELIVERED' }),
      );
    });

    it('never moves a READ message backwards', async () => {
      const { service, update } = buildStatus([agentMsg('READ')]);
      await service.listMessages(session);
      expect(update).not.toHaveBeenCalled();
    });

    it('marks everything READ when the visitor has the chat in view', async () => {
      const { service, update } = buildStatus([
        agentMsg('SENT'),
        { ...agentMsg('DELIVERED'), id: 'a2' },
      ]);
      await service.markAgentMessagesRead(session);
      expect(update).toHaveBeenCalledWith(expect.anything(), {
        status: 'READ',
      });
    });

    it('shows "seen" on the visitor\'s messages only when the workspace shares read receipts', async () => {
      const inbound = {
        id: 'i1',
        workspaceId: 'w1',
        conversationId: 'c1',
        direction: 'INBOUND',
        status: 'READ',
        externalMessageId: 'x',
        attachments: [],
      };
      expect(
        (await buildStatus([inbound], true).service.listMessages(session))[0]
          .seen,
      ).toBe(true);
      expect(
        (await buildStatus([inbound], false).service.listMessages(session))[0]
          .seen,
      ).toBe(false);
    });
  });
});
