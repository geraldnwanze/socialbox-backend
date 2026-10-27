import { LiveChatAdapter } from './live-chat.adapter';
import {
  MessageStatus,
  MessageType,
} from '../../../messages/enums/message.enums';

describe('LiveChatAdapter', () => {
  const adapter = new LiveChatAdapter();

  describe('connect', () => {
    it('generates a widget key and applies defaults', async () => {
      const result = await adapter.connect({});
      expect(result.externalAccountId).toMatch(/^wk_[0-9a-f]{32}$/);
      expect(result.metadata).toMatchObject({
        title: 'Chat with us',
        color: '#4F46E5',
        allowedOrigins: [],
        askEmail: true,
      });
    });

    it('always requires the email, whatever the settings say', async () => {
      const result = await adapter.connect({ askEmail: 'false' });
      expect(result.metadata?.askEmail).toBe(true);
    });

    it('keeps the previous key on reconnect so embedded snippets keep working', async () => {
      const result = await adapter.connect({
        previousExternalAccountId: 'wk_old',
      });
      expect(result.externalAccountId).toBe('wk_old');
    });

    it('normalizes allowed origins from a comma-separated string, dropping paths and duplicates', async () => {
      const result = await adapter.connect({
        allowedOrigins:
          'https://example.com/pricing, https://example.com, http://localhost:8080',
      });
      expect(result.metadata?.allowedOrigins).toEqual([
        'https://example.com',
        'http://localhost:8080',
      ]);
    });

    it.each(['not a url', 'javascript:alert(1)', 'ftp://example.com'])(
      'rejects an invalid origin %s',
      async (origin) => {
        await expect(
          adapter.connect({ allowedOrigins: origin }),
        ).rejects.toThrow();
      },
    );

    it('rejects a color that is not a 6-digit hex value (it is inserted into widget CSS)', async () => {
      await expect(
        adapter.connect({ color: 'red;}body{display:none' }),
      ).rejects.toThrow();
    });
  });

  it('builds one idempotency key per visitor message', () => {
    expect(
      adapter.extractEventKeys({
        messageId: 'abc12345',
        visitorId: 'v',
        text: 'hi',
      }),
    ).toEqual(['livechat:abc12345']);
    expect(adapter.extractEventKeys({})).toEqual([]);
  });

  it('normalizes a visitor message into an inbound event keyed on the visitor', async () => {
    const [event] = await adapter.handleWebhook(
      { visitorId: 'abcd-1234', messageId: 'm-12345678', text: 'Hello' },
      {} as never,
    );
    expect(event).toMatchObject({
      kind: 'INBOUND_MESSAGE',
      externalConversationId: 'abcd-1234',
      externalMessageId: 'm-12345678',
      messageType: MessageType.TEXT,
      content: 'Hello',
      contact: {
        externalUserId: 'abcd-1234',
        fallbackDisplayName: 'Website visitor ABCD',
      },
    });
  });

  it('uses the pre-chat name and email, and maps stored attachments', async () => {
    const [event] = await adapter.handleWebhook(
      {
        visitorId: 'abcd-1234',
        messageId: 'm-12345679',
        text: '',
        profile: { name: 'Wendy', email: 'w@x.com' },
        attachments: [
          {
            storageKey: 'k',
            mimeType: 'application/pdf',
            fileName: 'a.pdf',
            size: 3,
          },
        ],
      },
      {} as never,
    );
    expect(event).toMatchObject({
      messageType: MessageType.DOCUMENT,
      contact: { displayName: 'Wendy', email: 'w@x.com' },
      attachments: [{ storageKey: 'k', fileName: 'a.pdf' }],
    });
  });

  it('passes visitor facts through as contact metadata with a lastSeenAt stamp', async () => {
    const [event] = await adapter.handleWebhook(
      {
        visitorId: 'abcd-1234',
        messageId: 'm-12345678',
        text: 'Hello',
        visitor: {
          ip: '8.8.8.8',
          countryCode: 'US',
          pageUrl: 'https://shop.example.com/cart',
        },
      },
      {} as never,
    );
    expect(event).toMatchObject({
      contact: {
        metadata: {
          ip: '8.8.8.8',
          countryCode: 'US',
          pageUrl: 'https://shop.example.com/cart',
          lastSeenAt: expect.any(String),
        },
      },
    });
  });

  it('marks agent text replies as SENT and refuses attachments', async () => {
    const sent = await adapter.sendMessage({} as never, {} as never, {
      type: MessageType.TEXT,
      text: 'hi',
    });
    expect(sent.status).toBe(MessageStatus.SENT);
    await expect(
      adapter.sendMessage({} as never, {} as never, {
        type: MessageType.IMAGE,
      }),
    ).rejects.toThrow();
  });
});
