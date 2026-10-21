import { ConversationsService } from './conversations.service';

describe('ConversationsService.markRead', () => {
  function build(rawRows: object[]) {
    const conversation = { id: 'c1', workspaceId: 'w1', unreadCount: 3 };
    const conversations = {
      findOne: jest.fn().mockResolvedValue(conversation),
      save: jest.fn(),
    };
    const qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: rawRows }),
    };
    const messages = { createQueryBuilder: jest.fn().mockReturnValue(qb) };
    const queue = { add: jest.fn() };
    const realtime = { toWorkspace: jest.fn() };
    const service = new ConversationsService(
      conversations as never,
      {} as never,
      {} as never,
      {} as never,
      messages as never,
      queue as never,
      {} as never,
      realtime as never,
      {} as never,
    );
    return { service, conversation, queue, qb };
  }

  it('clears the unread count and queues one receipt with the newly read ids, oldest first', async () => {
    const { service, conversation, queue, qb } = build([
      { external_message_id: 'm2', sent_at: '2026-10-21T10:02:00Z' },
      { external_message_id: 'm1', sent_at: '2026-10-21T10:01:00Z' },
      { external_message_id: null, sent_at: '2026-10-21T10:03:00Z' },
    ]);
    await service.markRead('w1', 'c1');
    expect(conversation.unreadCount).toBe(0);
    expect(qb.andWhere).toHaveBeenCalledWith('status = :status', {
      status: 'RECEIVED',
    });
    expect(queue.add).toHaveBeenCalledWith('send', {
      conversationId: 'c1',
      externalMessageIds: ['m1', 'm2'],
    });
  });

  it('sends nothing when no message was newly read (re-opening a read conversation)', async () => {
    const { service, queue } = build([]);
    await service.markRead('w1', 'c1');
    expect(queue.add).not.toHaveBeenCalled();
  });
});
