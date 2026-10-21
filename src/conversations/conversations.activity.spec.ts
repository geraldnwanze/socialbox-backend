import { ConversationsService } from './conversations.service';
import { ConversationStatus } from './enums/conversation-status.enum';

describe('ConversationsService activity events', () => {
  function build(current: object) {
    const conversations = {
      findOne: jest.fn().mockResolvedValue(current),
      findOneOrFail: jest.fn().mockResolvedValue(current),
      update: jest.fn(),
      save: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue({
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn(),
      }),
    };
    const events = { record: jest.fn() };
    const realtime = { toWorkspace: jest.fn(), toConversation: jest.fn() };
    const service = new ConversationsService(
      conversations as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      realtime as never,
      {} as never,
      events as never,
    );
    return { service, events, conversations };
  }

  it('logs a customer message that reopens a resolved conversation as an automatic status change', async () => {
    const { service, events } = build({
      id: 'c1',
      workspaceId: 'w1',
      status: ConversationStatus.RESOLVED,
    });
    await service.recordInboundMessage('c1', 'hi', new Date());
    expect(events.record).toHaveBeenCalledWith(
      'w1',
      'c1',
      'STATUS_CHANGED',
      null,
      {
        from: 'RESOLVED',
        to: 'OPEN',
        auto: true,
      },
    );
  });

  it('logs nothing when the conversation was already open', async () => {
    const { service, events } = build({
      id: 'c1',
      workspaceId: 'w1',
      status: ConversationStatus.OPEN,
    });
    await service.recordInboundMessage('c1', 'hi', new Date());
    expect(events.record).not.toHaveBeenCalled();
  });

  it('does not log a priority "change" to the same value', async () => {
    const current = {
      id: 'c1',
      workspaceId: 'w1',
      priority: 'NORMAL',
      status: 'OPEN',
    };
    const { service, events } = build(current);
    jest
      .spyOn(service, 'findOneForWorkspace')
      .mockResolvedValue(current as never);
    await service.setPriority('w1', 'c1', 'NORMAL' as never, 'm1');
    expect(events.record).not.toHaveBeenCalled();
  });
});
