import { ReadReceiptProcessor } from './read-receipt.processor';

describe('ReadReceiptProcessor', () => {
  function build(opts: {
    notifiesCustomer: boolean;
    sendReadReceipts: boolean;
    supported?: boolean;
  }) {
    const markAsRead = jest.fn();
    const adapter = {
      capabilities: {
        markAsRead: opts.supported ?? true,
        markAsReadNotifiesCustomer: opts.notifiesCustomer,
      },
      markAsRead,
    };
    const processor = new ReadReceiptProcessor(
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'c1',
          workspaceId: 'w1',
          channelConnectionId: 'cc1',
          externalConversationId: 'ext',
        }),
      } as never,
      {
        findOne: jest
          .fn()
          .mockResolvedValue({ sendReadReceipts: opts.sendReadReceipts }),
      } as never,
      {
        loadWithCredentials: jest.fn().mockResolvedValue({ type: 'WHATSAPP' }),
      } as never,
      { find: jest.fn().mockReturnValue(adapter) } as never,
    );
    const job = {
      data: { conversationId: 'c1', externalMessageIds: ['m1', 'm2'] },
    };
    return { processor, markAsRead, job };
  }

  it('tells the channel which messages were read, newest as the anchor', async () => {
    const { processor, markAsRead, job } = build({
      notifiesCustomer: true,
      sendReadReceipts: true,
    });
    await processor.process(job as never);
    expect(markAsRead).toHaveBeenCalledWith(
      { type: 'WHATSAPP' },
      expect.objectContaining({
        lastInboundExternalMessageId: 'm2',
        readExternalMessageIds: ['m1', 'm2'],
      }),
    );
  });

  it('does not notify the customer when the workspace turned read receipts off', async () => {
    const { processor, markAsRead, job } = build({
      notifiesCustomer: true,
      sendReadReceipts: false,
    });
    await processor.process(job as never);
    expect(markAsRead).not.toHaveBeenCalled();
  });

  it("still tidies the agents' own side (e.g. mailbox flags) with receipts off", async () => {
    const { processor, markAsRead, job } = build({
      notifiesCustomer: false,
      sendReadReceipts: false,
    });
    await processor.process(job as never);
    expect(markAsRead).toHaveBeenCalled();
  });

  it('skips channels without mark-as-read', async () => {
    const { processor, markAsRead, job } = build({
      notifiesCustomer: false,
      sendReadReceipts: true,
      supported: false,
    });
    await processor.process(job as never);
    expect(markAsRead).not.toHaveBeenCalled();
  });
});
