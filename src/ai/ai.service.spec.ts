import { AiService } from './ai.service';

describe('AiService', () => {
  const summaryJson = JSON.stringify({
    summary: 'Wants a refund.',
    sentiment: 'NEGATIVE',
    intent: 'Refund',
    needsReply: true,
    nextStep: 'Check order',
  });

  function build(
    opts: {
      configured?: boolean;
      enabled?: boolean;
      reply?: string;
      limit?: number;
      used?: number;
      cached?: string | null;
    } = {},
  ) {
    const complete = jest.fn().mockResolvedValue(opts.reply ?? summaryJson);
    const ai = { isConfigured: () => opts.configured ?? true, complete };
    const redis = {
      get: jest.fn().mockResolvedValue(opts.cached ?? null),
      set: jest.fn(),
      incr: jest.fn().mockResolvedValue(opts.used ?? 1),
      expire: jest.fn(),
    };
    const messages = [
      {
        id: 'm1',
        direction: 'INBOUND',
        senderType: 'CONTACT',
        content: 'Where is my order?',
        messageType: 'TEXT',
        metadata: { subject: 'Order 42' },
      },
      {
        id: 'm2',
        direction: 'OUTBOUND',
        senderType: 'AGENT',
        content: 'Checking now',
        messageType: 'TEXT',
        metadata: {},
      },
      {
        id: 'm3',
        direction: 'OUTBOUND',
        senderType: 'SYSTEM',
        content: 'We are away',
        messageType: 'TEXT',
        metadata: {},
      },
    ];
    const conversations = {
      findOneForWorkspace: jest
        .fn()
        .mockResolvedValue({ id: 'c1', channelConnection: { type: 'EMAIL' } }),
    };
    const service = new AiService(
      ai as never,
      { get: jest.fn().mockReturnValue(opts.limit ?? 500) } as never,
      conversations as never,
      { find: jest.fn().mockResolvedValue([...messages].reverse()) } as never,
      {
        findOne: jest.fn().mockResolvedValue({ fullName: 'Ann Lee' }),
      } as never,
      {
        findOne: jest.fn().mockResolvedValue({
          id: 'w1',
          name: 'Acme',
          aiAssistEnabled: opts.enabled ?? true,
        }),
      } as never,
      {
        find: jest
          .fn()
          .mockResolvedValue([
            { title: 'Shipping', content: 'We ship in 2-3 days.' },
          ]),
      } as never,
      redis as never,
    );
    return { service, complete, redis, conversations };
  }

  it('summarizes with a readable transcript, parses the answer and caches it', async () => {
    const { service, complete, redis } = build();
    const result = await service.summarize('w1', 'c1');
    expect(result).toMatchObject({
      summary: 'Wants a refund.',
      sentiment: 'NEGATIVE',
      needsReply: true,
      cached: false,
    });
    const prompt = complete.mock.calls[0][0].user as string;
    expect(prompt).toContain(
      'Customer (subject: Order 42): Where is my order?',
    );
    expect(prompt).toContain('Agent: Checking now');
    expect(prompt).toContain('Automated reply: We are away');
    expect(redis.set).toHaveBeenCalledWith(
      'ai:summary:c1:m3',
      expect.any(String),
      'EX',
      86400,
    );
  });

  it('serves an unchanged conversation from the cache without calling the model or using quota', async () => {
    const { service, complete, redis } = build({ cached: summaryJson });
    const result = await service.summarize('w1', 'c1');
    expect(result.cached).toBe(true);
    expect(complete).not.toHaveBeenCalled();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('refuses when the server has no key, the workspace has not opted in, or the daily cap is hit', async () => {
    await expect(
      build({ configured: false }).service.summarize('w1', 'c1'),
    ).rejects.toMatchObject({ code: 'AI_NOT_CONFIGURED' });
    await expect(
      build({ enabled: false }).service.summarize('w1', 'c1'),
    ).rejects.toMatchObject({ code: 'AI_DISABLED' });
    await expect(
      build({ limit: 5, used: 6 }).service.summarize('w1', 'c1'),
    ).rejects.toMatchObject({ code: 'AI_LIMIT' });
    const off = build({ enabled: false });
    await expect(
      off.service.suggestReply('w1', 'c1', 'u1'),
    ).rejects.toMatchObject({ code: 'AI_DISABLED' });
    expect(off.complete).not.toHaveBeenCalled();
  });

  it('drafts a reply with the agent, workspace, channel, approved wording and any steer', async () => {
    const { service, complete } = build({ reply: '  Hi! It ships today.  ' });
    const result = await service.suggestReply(
      'w1',
      'c1',
      'u1',
      'offer free shipping',
    );
    expect(result.text).toBe('Hi! It ships today.');
    const call = complete.mock.calls[0][0];
    expect(call.system).toContain('Ann, a support agent at Acme');
    expect(call.system).toContain('sign-off with the agent');
    expect(call.system).toContain('- Shipping: We ship in 2-3 days.');
    expect(call.user).toContain(
      "The agent's guidance for this reply: offer free shipping",
    );
  });

  it('does not wait on a model call for an unusable summary', async () => {
    await expect(
      build({ reply: 'sorry, I cannot do that' }).service.summarize('w1', 'c1'),
    ).rejects.toMatchObject({ code: 'AI_FAILED' });
  });

  it('rewrites a draft in the chosen tone', async () => {
    const { service, complete } = build({ reply: 'Thanks so much!' });
    expect(await service.rewrite('w1', 'thanks', 'friendlier')).toEqual({
      text: 'Thanks so much!',
    });
    expect(complete.mock.calls[0][0].system).toContain('warmer and friendlier');
    expect(complete.mock.calls[0][0].user).toBe('thanks');
  });
});
