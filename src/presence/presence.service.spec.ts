import {
  PresenceService,
  TYPING_TTL_MS,
  VIEW_TTL_MS,
} from './presence.service';

/** Just enough of ioredis for the hash operations the service uses. */
class FakeRedis {
  hashes = new Map<string, Map<string, string>>();
  strings = new Map<string, string>();
  async hget(key: string, field: string) {
    return this.hashes.get(key)?.get(field) ?? null;
  }
  async hset(key: string, field: string, value: string) {
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    this.hashes.get(key)!.set(field, value);
  }
  async hgetall(key: string) {
    return Object.fromEntries(this.hashes.get(key) ?? []);
  }
  async hdel(key: string, ...fields: string[]) {
    fields.forEach((f) => this.hashes.get(key)?.delete(f));
  }
  async expire() {}
  async set(key: string, value: string) {
    this.strings.set(key, value);
  }
}

describe('PresenceService', () => {
  const NOW = 1_000_000;

  function build(conversationExists = true) {
    const redis = new FakeRedis();
    const realtime = { toWorkspace: jest.fn() };
    const names: Record<string, string> = { u1: 'Ann Lee', u2: 'Bob Stone' };
    const service = new PresenceService(
      redis as never,
      realtime as never,
      { exists: jest.fn().mockResolvedValue(conversationExists) } as never,
      {
        findOne: jest.fn(({ where }) =>
          Promise.resolve({ fullName: names[where.id] }),
        ),
      } as never,
    );
    return { service, redis, realtime };
  }

  it('lists who has the conversation open, with names, and broadcasts it to the workspace', async () => {
    const { service, realtime } = build();
    await service.touch('w1', 'c1', 'u1', false, NOW);
    const viewers = await service.touch('w1', 'c1', 'u2', false, NOW + 1000);
    expect(viewers.map((v) => [v.name, v.typing])).toEqual([
      ['Ann Lee', false],
      ['Bob Stone', false],
    ]);
    expect(realtime.toWorkspace).toHaveBeenLastCalledWith(
      'w1',
      'conversation.presence',
      {
        conversationId: 'c1',
        viewers,
      },
    );
  });

  it('shows typing only briefly, and also sets the flag the customer-facing widget reads', async () => {
    const { service, redis } = build();
    let viewers = await service.touch('w1', 'c1', 'u1', true, NOW);
    expect(viewers[0].typing).toBe(true);
    expect(redis.strings.get('typing:agent:c1')).toBe('1');

    viewers = await service.snapshot('c1', NOW + TYPING_TTL_MS + 1);
    expect(viewers[0].typing).toBe(false); // stopped typing, still viewing
  });

  it('drops people whose pings stopped (closed tab, lost connection)', async () => {
    const { service } = build();
    await service.touch('w1', 'c1', 'u1', false, NOW);
    expect(await service.snapshot('c1', NOW + VIEW_TTL_MS - 1)).toHaveLength(1);
    expect(await service.snapshot('c1', NOW + VIEW_TTL_MS + 1)).toHaveLength(0);
  });

  it('removes someone immediately when they leave', async () => {
    const { service, realtime } = build();
    await service.touch('w1', 'c1', 'u1', false, NOW);
    await service.touch('w1', 'c1', 'u2', false, NOW);
    await service.leave('w1', 'c1', 'u1', NOW + 10);
    const last = realtime.toWorkspace.mock.calls.at(-1)![2];
    expect(last.viewers.map((v: { name: string }) => v.name)).toEqual([
      'Bob Stone',
    ]);
  });

  it('refuses conversations outside the workspace', async () => {
    const { service, realtime } = build(false);
    await expect(service.touch('w1', 'other', 'u1', false)).rejects.toThrow(
      'Conversation not found',
    );
    expect(realtime.toWorkspace).not.toHaveBeenCalled();
  });
});
