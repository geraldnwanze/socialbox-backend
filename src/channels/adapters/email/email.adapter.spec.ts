import { EmailAdapter } from './email.adapter';
import { ChannelType } from '../../enums/channel-type.enum';
import { MessageType } from '../../../messages/enums/message.enums';
import * as clients from './email-clients';

jest.mock('./email-clients', () => ({
  ...jest.requireActual('./email-clients'),
  createSmtpTransport: jest.fn(),
}));

const adapter = new EmailAdapter({ get: () => false } as never);
const connection = {
  id: 'conn',
  type: ChannelType.EMAIL,
  credentials: {
    email: 'support@example.com',
    fromName: 'Support',
    username: 'support@example.com',
    password: 'pw',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecurity: 'STARTTLS',
  },
} as never;

describe('EmailAdapter.handleWebhook', () => {
  it('makes one conversation per sender address and keeps the subject on the message', async () => {
    const [event] = await adapter.handleWebhook(
      {
        messageId: '<a@x>',
        fromAddress: 'Ann.Lee@X.com',
        subject: 'Order 42',
        text: 'Where is it?',
        sentAt: '2026-10-20T10:00:00.000Z',
        inReplyTo: '<prev@x>',
      },
      connection,
    );
    expect(event).toMatchObject({
      kind: 'INBOUND_MESSAGE',
      externalConversationId: 'ann.lee@x.com',
      externalMessageId: '<a@x>',
      contact: { externalUserId: 'ann.lee@x.com', displayName: 'Ann Lee' },
      content: 'Where is it?',
      messageMetadata: { subject: 'Order 42', inReplyTo: '<prev@x>' },
    });
  });

  it('carries sanitized html in the message metadata and maps stored attachments', async () => {
    const [event] = await adapter.handleWebhook(
      {
        messageId: '<c@x>',
        fromAddress: 'a@x.com',
        subject: 'Invoice',
        text: 'See attached',
        html: '<p>See attached</p>',
        sentAt: '2026-10-20T10:00:00Z',
        attachments: [
          {
            storageKey: 'workspaces/w/1.pdf',
            mimeType: 'application/pdf',
            fileName: 'inv.pdf',
            size: 12,
          },
        ],
      },
      connection,
    );
    expect(event).toMatchObject({
      messageMetadata: { subject: 'Invoice', html: '<p>See attached</p>' },
      attachments: [
        {
          storageKey: 'workspaces/w/1.pdf',
          mimeType: 'application/pdf',
          fileName: 'inv.pdf',
          size: 12,
        },
      ],
    });
  });

  it('prefers the sender-provided display name', async () => {
    const [event] = await adapter.handleWebhook(
      {
        messageId: '<b@x>',
        fromAddress: 'a@x.com',
        fromName: 'Dr. Ann',
        subject: '',
        text: 'hi',
        sentAt: '2026-10-20T10:00:00Z',
      },
      connection,
    );
    expect(event).toMatchObject({ contact: { displayName: 'Dr. Ann' } });
  });

  it('keys events by Message-ID so a re-delivered mail is deduplicated', () => {
    expect(adapter.extractEventKeys({ messageId: '<a@x>' })).toEqual([
      'email:<a@x>',
    ]);
    expect(adapter.extractEventKeys({})).toEqual([]);
  });
});

describe('EmailAdapter.sendMessage', () => {
  const send = (sendMail: jest.Mock) => {
    (clients.createSmtpTransport as jest.Mock).mockResolvedValue({
      sendMail,
      close: jest.fn(),
    });
    return adapter.sendMessage(
      connection,
      {
        id: 'c',
        externalConversationId: 'ann@x.com',
        contactExternalId: '',
        lastInboundExternalMessageId: '<a@x>',
        lastInboundSubject: 'Re: Order 42',
      },
      { type: MessageType.TEXT, text: 'On its way' },
    );
  };

  it('replies to the customer, threaded under their last mail', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<out@x>' });
    const result = await send(sendMail);
    expect(sendMail).toHaveBeenCalledWith({
      from: { name: 'Support', address: 'support@example.com' },
      to: 'ann@x.com',
      subject: 'Re: Order 42',
      text: 'On its way',
      inReplyTo: '<a@x>',
      references: ['<a@x>'],
    });
    expect(result).toEqual({ externalMessageId: '<out@x>', status: 'SENT' });
  });

  it('treats a permanent SMTP rejection as terminal but a timeout as retryable', async () => {
    await expect(
      send(jest.fn().mockRejectedValue({ responseCode: 550 })),
    ).rejects.toMatchObject({
      code: 'EMAIL_CONNECTION_FAILED',
    });
    const timeout = { code: 'ETIMEDOUT' };
    await expect(send(jest.fn().mockRejectedValue(timeout))).rejects.toBe(
      timeout,
    );
  });

  it('sends an attachment, fetching it from the server-internal URL', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<out2@x>' });
    (clients.createSmtpTransport as jest.Mock).mockResolvedValue({
      sendMail,
      close: jest.fn(),
    });
    await adapter.sendMessage(
      connection,
      { id: 'c', externalConversationId: 'ann@x.com', contactExternalId: '' },
      {
        type: MessageType.DOCUMENT,
        attachment: {
          url: 'https://public/x',
          internalUrl: 'http://minio:9000/x',
          mimeType: 'application/pdf',
          fileName: 'inv.pdf',
        },
      },
    );
    expect(sendMail.mock.calls[0][0]).toMatchObject({
      text: '',
      attachments: [
        {
          filename: 'inv.pdf',
          path: 'http://minio:9000/x',
          contentType: 'application/pdf',
        },
      ],
    });
  });

  it('refuses non-text messages', async () => {
    await expect(
      adapter.sendMessage(
        connection,
        { id: 'c', externalConversationId: 'a@x.com', contactExternalId: '' },
        {
          type: MessageType.IMAGE,
        },
      ),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_MESSAGE_TYPE' });
  });
});
