import { FilterLookups, parseFilters } from './inbox-views.validation';

const ID = '11111111-1111-4111-8111-111111111111';
const lookups = (ok = true): FilterLookups => ({
  channelConnectionExists: async () => ok,
  memberExists: async () => ok,
  tagExists: async () => ok,
});

describe('parseFilters', () => {
  it('keeps known filters and drops empty ones', async () => {
    expect(
      await parseFilters(
        {
          status: 'OPEN',
          unreadOnly: false,
          search: '  refund  ',
          priority: 'HIGH',
          sort: 'oldest',
          assignedTo: 'me',
        },
        lookups(),
      ),
    ).toEqual({
      status: 'OPEN',
      search: 'refund',
      priority: 'HIGH',
      sort: 'oldest',
      assignedTo: 'me',
    });
    expect(await parseFilters({}, lookups())).toEqual({});
  });

  it('rejects unknown keys and bad values', async () => {
    await expect(parseFilters({ evil: 1 }, lookups())).rejects.toThrow(
      'Unknown filter',
    );
    await expect(parseFilters({ status: 'DONE' }, lookups())).rejects.toThrow(
      'Status must be',
    );
    await expect(parseFilters({ priority: 'SOON' }, lookups())).rejects.toThrow(
      'Invalid priority',
    );
    await expect(parseFilters({ sort: 'random' }, lookups())).rejects.toThrow(
      'Sort must be',
    );
    await expect(
      parseFilters({ unreadOnly: 'yes' }, lookups()),
    ).rejects.toThrow('true or false');
    await expect(
      parseFilters({ search: 'x'.repeat(101) }, lookups()),
    ).rejects.toThrow('too long');
    await expect(parseFilters([], lookups())).rejects.toThrow(
      'must be an object',
    );
  });

  it('only accepts ids that exist in the workspace', async () => {
    await expect(parseFilters({ tagId: ID }, lookups(false))).rejects.toThrow(
      'tag from this workspace',
    );
    await expect(
      parseFilters({ channelConnectionId: ID }, lookups(false)),
    ).rejects.toThrow('channel from this workspace');
    await expect(
      parseFilters({ assignedTo: ID }, lookups(false)),
    ).rejects.toThrow('teammate from this workspace');
    await expect(
      parseFilters({ tagId: 'not-a-uuid' }, lookups()),
    ).rejects.toThrow('tag from this workspace');
    expect(
      await parseFilters({ tagId: ID, assignedTo: 'unassigned' }, lookups()),
    ).toEqual({ tagId: ID, assignedTo: 'unassigned' });
  });
});
