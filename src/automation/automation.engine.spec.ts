import {
  conditionMatches,
  containsAnyKeyword,
  expandPlaceholders,
  pickLeastBusy,
  rulesMatch,
} from './automation.engine';
import { ChannelType } from '../channels/enums/channel-type.enum';
import { AutomationCondition, MatchContext } from './automation.types';

const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
  text: 'Where is my REFUND?',
  channelType: ChannelType.EMAIL,
  isNewConversation: false,
  assigned: false,
  now: new Date('2026-10-21T14:00:00Z'), // Wednesday
  ...over,
});

describe('conditions', () => {
  it('matches keywords case-insensitively and as substrings', () => {
    expect(containsAnyKeyword('Where is my REFUND?', ['refund'])).toBe(true);
    expect(containsAnyKeyword('Refunds please', ['refund'])).toBe(true);
    expect(containsAnyKeyword('hello', ['refund', ' '])).toBe(false);
  });

  it('matches channel, first message and unassigned', () => {
    expect(
      conditionMatches(
        { type: 'CHANNEL', channels: [ChannelType.EMAIL] },
        ctx(),
      ),
    ).toBe(true);
    expect(
      conditionMatches(
        { type: 'CHANNEL', channels: [ChannelType.TELEGRAM] },
        ctx(),
      ),
    ).toBe(false);
    expect(conditionMatches({ type: 'FIRST_MESSAGE' }, ctx())).toBe(false);
    expect(
      conditionMatches(
        { type: 'FIRST_MESSAGE' },
        ctx({ isNewConversation: true }),
      ),
    ).toBe(true);
    expect(
      conditionMatches({ type: 'UNASSIGNED' }, ctx({ assigned: true })),
    ).toBe(false);
  });

  it('OUTSIDE_HOURS is true only when the message arrives while closed', () => {
    const hours = {
      enabled: true,
      timezone: 'UTC',
      days: [1, 2, 3, 4, 5],
      start: '09:00',
      end: '17:00',
    };
    expect(conditionMatches({ type: 'OUTSIDE_HOURS', hours }, ctx())).toBe(
      false,
    ); // Wed 14:00 is open
    expect(
      conditionMatches(
        { type: 'OUTSIDE_HOURS', hours },
        ctx({ now: new Date('2026-10-21T20:00:00Z') }),
      ),
    ).toBe(true);
    expect(
      conditionMatches(
        { type: 'OUTSIDE_HOURS', hours },
        ctx({ now: new Date('2026-10-24T14:00:00Z') }),
      ),
    ).toBe(true); // Saturday
  });

  it('needs every condition to hold, and an empty list always matches', () => {
    const both: AutomationCondition[] = [
      { type: 'CHANNEL', channels: [ChannelType.EMAIL] },
      { type: 'KEYWORDS', keywords: ['refund'] },
    ];
    expect(rulesMatch(both, ctx())).toBe(true);
    expect(rulesMatch(both, ctx({ channelType: ChannelType.TELEGRAM }))).toBe(
      false,
    );
    expect(rulesMatch([], ctx())).toBe(true);
  });
});

describe('pickLeastBusy', () => {
  it('picks whoever has the fewest open conversations', () => {
    const counts = new Map([
      ['a', 5],
      ['b', 1],
      ['c', 3],
    ]);
    expect(pickLeastBusy(['a', 'b', 'c'], counts)).toBe('b');
  });

  it('treats people with no conversations as zero and breaks ties randomly', () => {
    const counts = new Map([['a', 2]]);
    expect(pickLeastBusy(['a', 'b', 'c'], counts, () => 0)).toBe('b');
    expect(pickLeastBusy(['a', 'b', 'c'], counts, () => 0.99)).toBe('c');
  });

  it('returns null with nobody to pick', () => {
    expect(pickLeastBusy([], new Map())).toBeNull();
  });
});

describe('expandPlaceholders', () => {
  it('uses the first name, or "there" for unnamed and generated names', () => {
    expect(
      expandPlaceholders('Hi {{customer_name}}!', { customerName: 'Ann Lee' }),
    ).toBe('Hi Ann!');
    expect(
      expandPlaceholders('Hi {{ customer_name }}!', {
        customerName: 'Website visitor 3D74',
      }),
    ).toBe('Hi there!');
    expect(expandPlaceholders('Hi {{customer_name}}!', {})).toBe('Hi there!');
  });
});
