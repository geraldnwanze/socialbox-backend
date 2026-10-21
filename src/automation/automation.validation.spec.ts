import {
  parseActions,
  parseConditions,
  ValidationLookups,
} from './automation.validation';

const lookups = (
  members: string[] = ['m1', 'm2'],
  tags: string[] = ['t1'],
): ValidationLookups => ({
  existingMemberIds: async (ids) =>
    new Set(ids.filter((i) => members.includes(i))),
  tagExists: async (id) => tags.includes(id),
});

describe('parseConditions', () => {
  it('cleans keywords and channels', async () => {
    expect(
      await parseConditions([
        {
          type: 'KEYWORDS',
          keywords: [' refund ', 'refund', '', 'Chargeback'],
        },
        { type: 'CHANNEL', channels: ['EMAIL', 'EMAIL'] },
      ]),
    ).toEqual([
      { type: 'KEYWORDS', keywords: ['refund', 'Chargeback'] },
      { type: 'CHANNEL', channels: ['EMAIL'] },
    ]);
  });

  it('rejects unknown, duplicate and empty conditions with readable messages', async () => {
    await expect(parseConditions([{ type: 'NOPE' }])).rejects.toThrow(
      'Unknown condition',
    );
    await expect(
      parseConditions([{ type: 'FIRST_MESSAGE' }, { type: 'FIRST_MESSAGE' }]),
    ).rejects.toThrow('only once');
    await expect(
      parseConditions([{ type: 'KEYWORDS', keywords: [] }]),
    ).rejects.toThrow('at least one keyword');
    await expect(
      parseConditions([{ type: 'CHANNEL', channels: ['MYSPACE'] }]),
    ).rejects.toThrow('valid channel');
    await expect(parseConditions('x')).rejects.toThrow('must be a list');
  });

  it('validates opening hours', async () => {
    await expect(
      parseConditions([
        { type: 'OUTSIDE_HOURS', hours: { timezone: 'Mars/Base' } },
      ]),
    ).rejects.toThrow('time zone');
    const [c] = await parseConditions([
      {
        type: 'OUTSIDE_HOURS',
        hours: { timezone: 'UTC', start: '09:00', end: '17:00' },
      },
    ]);
    expect(c).toMatchObject({
      type: 'OUTSIDE_HOURS',
      hours: { enabled: true, timezone: 'UTC' },
    });
  });
});

describe('parseActions', () => {
  it('requires real workspace members and tags', async () => {
    await expect(
      parseActions([{ type: 'ASSIGN', memberIds: ['stranger'] }], lookups()),
    ).rejects.toThrow('this workspace');
    await expect(
      parseActions([{ type: 'ADD_TAG', tagId: 'other-ws-tag' }], lookups()),
    ).rejects.toThrow('tag from this workspace');
    expect(
      await parseActions(
        [
          { type: 'ASSIGN', memberIds: [] },
          { type: 'ADD_TAG', tagId: 't1' },
        ],
        lookups(),
      ),
    ).toEqual([
      { type: 'ASSIGN', memberIds: [] },
      { type: 'ADD_TAG', tagId: 't1' },
    ]);
  });

  it('validates replies and priorities, defaulting the reply cooldown', async () => {
    await expect(
      parseActions([{ type: 'AUTO_REPLY', text: '  ' }], lookups()),
    ).rejects.toThrow('needs some text');
    await expect(
      parseActions(
        [{ type: 'AUTO_REPLY', text: 'hi', cooldownMinutes: 0 }],
        lookups(),
      ),
    ).rejects.toThrow('cooldown');
    await expect(
      parseActions([{ type: 'SET_PRIORITY', priority: 'SOON' }], lookups()),
    ).rejects.toThrow('valid priority');
    expect(
      await parseActions(
        [{ type: 'AUTO_REPLY', text: ' We reply within a day ' }],
        lookups(),
      ),
    ).toEqual([
      {
        type: 'AUTO_REPLY',
        text: 'We reply within a day',
        cooldownMinutes: 720,
      },
    ]);
  });

  it('needs at least one action and no repeats', async () => {
    await expect(parseActions([], lookups())).rejects.toThrow(
      'at least one action',
    );
    await expect(
      parseActions([{ type: 'RESOLVE' }, { type: 'RESOLVE' }], lookups()),
    ).rejects.toThrow('only once');
  });
});
