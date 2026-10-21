import { AutomationService } from './automation.service';
import { ChannelType } from '../channels/enums/channel-type.enum';

describe('AutomationService.run', () => {
  const input = {
    workspaceId: 'w1',
    conversationId: 'c1',
    channelConnectionId: 'cc1',
    channelType: ChannelType.EMAIL,
    text: 'I want a refund',
    isNewConversation: true,
    contactName: 'Ann Lee',
  };

  function build(
    rules: object[],
    opts: { assignedTo?: string | null; replyFresh?: boolean } = {},
  ) {
    const ruleRepo = {
      find: jest.fn().mockResolvedValue(rules),
      update: jest.fn(),
    };
    const members = {
      find: jest.fn().mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]),
    };
    const conversations = {
      findOne: jest
        .fn()
        .mockResolvedValue({ id: 'c1', assignedTo: opts.assignedTo ?? null }),
      createQueryBuilder: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest
          .fn()
          .mockResolvedValue([{ assigned_to: 'm1', count: '4' }]),
      }),
    };
    const conversationsService = {
      assign: jest.fn(),
      setPriority: jest.fn(),
      resolve: jest.fn(),
    };
    const messagesService = { createOutbound: jest.fn() };
    const tagsService = {
      attachToConversation: jest
        .fn()
        .mockResolvedValue({ added: true, tagName: 'Refund' }),
    };
    const events = { record: jest.fn() };
    const redis = {
      set: jest.fn().mockResolvedValue(opts.replyFresh === false ? null : 'OK'),
    };
    const service = new AutomationService(
      ruleRepo as never,
      members as never,
      {} as never,
      conversations as never,
      conversationsService as never,
      events as never,
      messagesService as never,
      tagsService as never,
      redis as never,
    );
    return {
      service,
      ruleRepo,
      conversationsService,
      messagesService,
      tagsService,
      events,
      redis,
    };
  }

  const rule = (name: string, conditions: object[], actions: object[]) => ({
    id: name,
    name,
    conditions,
    actions,
  });

  it('runs matching rules in order and records what it did, attributed to the rule', async () => {
    const { service, conversationsService, tagsService, events, ruleRepo } =
      build([
        rule(
          'Refunds',
          [{ type: 'KEYWORDS', keywords: ['refund'] }],
          [
            { type: 'ADD_TAG', tagId: 't1' },
            { type: 'SET_PRIORITY', priority: 'HIGH' },
          ],
        ),
        rule(
          'Other',
          [{ type: 'KEYWORDS', keywords: ['invoice'] }],
          [{ type: 'RESOLVE' }],
        ),
      ]);
    await service.run(input);
    expect(tagsService.attachToConversation).toHaveBeenCalledWith(
      'w1',
      'c1',
      't1',
    );
    expect(events.record).toHaveBeenCalledWith(
      'w1',
      'c1',
      'TAG_ADDED',
      null,
      expect.objectContaining({ via: 'automation', rule: 'Refunds' }),
    );
    expect(conversationsService.setPriority).toHaveBeenCalledWith(
      'w1',
      'c1',
      'HIGH',
      null,
      { via: 'automation', rule: 'Refunds' },
    );
    expect(conversationsService.resolve).not.toHaveBeenCalled();
    expect(ruleRepo.update).toHaveBeenCalledTimes(1); // only the rule that matched is counted
  });

  it('assigns to the least busy teammate, and the first assigning rule wins', async () => {
    const { service, conversationsService } = build([
      rule('First', [], [{ type: 'ASSIGN', memberIds: [] }]),
      rule('Second', [], [{ type: 'ASSIGN', memberIds: ['m1'] }]),
    ]);
    await service.run(input);
    expect(conversationsService.assign).toHaveBeenCalledTimes(1);
    expect(conversationsService.assign).toHaveBeenCalledWith(
      'w1',
      'c1',
      'm2',
      null,
      { via: 'automation', rule: 'First' },
    ); // m1 has 4 open
  });

  it('never takes a conversation away from its owner', async () => {
    const { service, conversationsService } = build(
      [rule('Assign', [], [{ type: 'ASSIGN', memberIds: [] }])],
      { assignedTo: 'm1' },
    );
    await service.run(input);
    expect(conversationsService.assign).not.toHaveBeenCalled();
  });

  it('"unassigned" conditions see assignments made by earlier rules in the same run', async () => {
    const { service, conversationsService } = build([
      rule('Assign', [], [{ type: 'ASSIGN', memberIds: ['m2'] }]),
      rule(
        'Only if unassigned',
        [{ type: 'UNASSIGNED' }],
        [{ type: 'SET_PRIORITY', priority: 'LOW' }],
      ),
    ]);
    await service.run(input);
    expect(conversationsService.setPriority).not.toHaveBeenCalled();
  });

  it('sends an automatic reply as the system, at most once per cooldown', async () => {
    const first = build([
      rule(
        'Away',
        [],
        [
          {
            type: 'AUTO_REPLY',
            text: 'Hi {{customer_name}}, we are away',
            cooldownMinutes: 60,
          },
        ],
      ),
    ]);
    await first.service.run(input);
    expect(first.redis.set).toHaveBeenCalledWith(
      'automation:reply:Away:c1',
      '1',
      'EX',
      3600,
      'NX',
    );
    expect(first.messagesService.createOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Hi Ann, we are away',
        automation: { ruleId: 'Away', ruleName: 'Away' },
      }),
    );

    const again = build(
      [
        rule(
          'Away',
          [],
          [{ type: 'AUTO_REPLY', text: 'x', cooldownMinutes: 60 }],
        ),
      ],
      { replyFresh: false },
    );
    await again.service.run(input);
    expect(again.messagesService.createOutbound).not.toHaveBeenCalled();
  });

  it('one failing action does not stop the rest, and nothing ever throws into the pipeline', async () => {
    const { service, conversationsService, tagsService } = build([
      rule(
        'Fragile',
        [],
        [
          { type: 'ADD_TAG', tagId: 't1' },
          { type: 'SET_PRIORITY', priority: 'URGENT' },
        ],
      ),
    ]);
    tagsService.attachToConversation.mockRejectedValue(
      new Error('tag deleted'),
    );
    await expect(service.run(input)).resolves.toBeUndefined();
    expect(conversationsService.setPriority).toHaveBeenCalled();
  });

  it('does nothing when the workspace has no enabled rules', async () => {
    const { service, ruleRepo } = build([]);
    await service.run(input);
    expect(ruleRepo.find).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: 'w1', enabled: true } }),
    );
  });
});
