import { Job } from 'bullmq';
import { OutboundMessageProcessor } from './outbound-message.processor';
import { MessageSendFailedException } from '../../common/exceptions/app.exception';
import { MessageStatus, MessageType } from '../../messages/enums/message.enums';

describe('OutboundMessageProcessor', () => {
  const baseMessage = {
    id: 'message-1',
    conversationId: 'conversation-1',
    channelConnectionId: 'connection-1',
    messageType: MessageType.TEXT,
    content: 'hello',
    attachments: [],
  };
  const conversation = {
    id: 'conversation-1',
    externalConversationId: 'ext-conv-1',
  };

  let messages: { findOne: jest.Mock };
  let conversations: { findOne: jest.Mock };
  let messagesService: {
    markSending: jest.Mock;
    markSent: jest.Mock;
    markFailed: jest.Mock;
  };
  let channelsService: { loadWithCredentials: jest.Mock };
  let adapter: { sendMessage: jest.Mock };
  let channelAdapterRegistry: { get: jest.Mock };
  let storageService: { getSignedDownloadUrl: jest.Mock };
  let processor: OutboundMessageProcessor;

  beforeEach(() => {
    messages = { findOne: jest.fn().mockResolvedValue(baseMessage) };
    conversations = { findOne: jest.fn().mockResolvedValue(conversation) };
    messagesService = {
      markSending: jest.fn(),
      markSent: jest.fn(),
      markFailed: jest.fn(),
    };
    channelsService = {
      loadWithCredentials: jest.fn().mockResolvedValue({ type: 'TELEGRAM' }),
    };
    adapter = { sendMessage: jest.fn() };
    channelAdapterRegistry = { get: jest.fn().mockReturnValue(adapter) };
    storageService = { getSignedDownloadUrl: jest.fn() };

    processor = new OutboundMessageProcessor(
      messages as any,
      conversations as any,
      messagesService as any,
      channelsService as any,
      channelAdapterRegistry as any,
      storageService as any,
    );
  });

  function job(overrides: Partial<Job> = {}): Job {
    return {
      data: { messageId: 'message-1' },
      opts: { attempts: 3 },
      attemptsMade: 0,
      ...overrides,
    } as Job;
  }

  it('marks the message SENT on a successful adapter call', async () => {
    adapter.sendMessage.mockResolvedValue({
      externalMessageId: 'ext-1',
      status: MessageStatus.SENT,
    });

    await processor.process(job());

    expect(messagesService.markSending).toHaveBeenCalledWith('message-1');
    expect(messagesService.markSent).toHaveBeenCalledWith('message-1', 'ext-1');
    expect(messagesService.markFailed).not.toHaveBeenCalled();
  });

  it('marks the message FAILED immediately (no retry) when the provider explicitly rejects it', async () => {
    adapter.sendMessage.mockRejectedValue(
      new MessageSendFailedException('Outside the 24h window'),
    );

    await processor.process(job());

    expect(messagesService.markFailed).toHaveBeenCalledWith(
      'message-1',
      'Outside the 24h window',
    );
  });

  it('rethrows a transient error without marking FAILED before the last attempt', async () => {
    adapter.sendMessage.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      processor.process(job({ attemptsMade: 0, opts: { attempts: 3 } })),
    ).rejects.toThrow('ECONNRESET');
    expect(messagesService.markFailed).not.toHaveBeenCalled();
  });

  it('marks the message FAILED once the queue has exhausted all retry attempts', async () => {
    adapter.sendMessage.mockRejectedValue(new Error('ECONNRESET'));

    await expect(
      processor.process(job({ attemptsMade: 2, opts: { attempts: 3 } })),
    ).rejects.toThrow('ECONNRESET');
    expect(messagesService.markFailed).toHaveBeenCalledWith(
      'message-1',
      'Delivery failed after multiple attempts',
    );
  });
});
