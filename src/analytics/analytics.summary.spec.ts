import {
  FirstResponseRow,
  distribution,
  fillDaily,
  percentile,
  summarizeByTag,
  summarizeFirstResponses,
} from './analytics.summary';

const at = (iso: string) => new Date(iso);
const row = (over: Partial<FirstResponseRow>): FirstResponseRow => ({
  conversationId: 'c',
  channelConnectionId: 'ch-1',
  channelType: 'TELEGRAM',
  channelName: 'bot',
  firstInboundAt: at('2026-10-20T10:00:00Z'),
  firstReplyAt: at('2026-10-20T10:01:00Z'),
  replyMemberId: 'm-1',
  replyMemberName: 'Ann',
  ...over,
});

describe('percentile / distribution', () => {
  it('interpolates and handles empty input', () => {
    expect(percentile([], 0.5)).toBeNull();
    expect(percentile([10], 0.9)).toBe(10);
    expect(percentile([0, 10], 0.5)).toBe(5);
    expect(distribution([])).toEqual({
      count: 0,
      avgSeconds: null,
      medianSeconds: null,
      p90Seconds: null,
    });
  });

  it('computes avg, median and p90 regardless of input order', () => {
    const d = distribution([300, 60, 120, 600, 30]);
    expect(d.count).toBe(5);
    expect(d.avgSeconds).toBe(222);
    expect(d.medianSeconds).toBe(120);
    expect(d.p90Seconds).toBe(480);
  });
});

describe('summarizeFirstResponses', () => {
  it('separates answered from unanswered and never counts unanswered as zero', () => {
    const s = summarizeFirstResponses([
      row({ conversationId: '1' }),
      row({ conversationId: '2', firstReplyAt: null, replyMemberId: null }),
    ]);
    expect(s.conversations).toBe(2);
    expect(s.answered).toBe(1);
    expect(s.unanswered).toBe(1);
    expect(s.firstResponse.medianSeconds).toBe(60);
  });

  it('breaks down by channel and credits the agent who replied first', () => {
    const s = summarizeFirstResponses([
      row({ conversationId: '1' }),
      row({
        conversationId: '2',
        channelConnectionId: 'ch-2',
        channelType: 'LIVE_CHAT',
        firstReplyAt: at('2026-10-20T10:05:00Z'),
        replyMemberId: 'm-2',
        replyMemberName: 'Bob',
      }),
      row({ conversationId: '3', firstReplyAt: at('2026-10-20T10:03:00Z') }),
    ]);
    expect(s.byChannel.map((c) => [c.type, c.conversations])).toEqual([
      ['TELEGRAM', 2],
      ['LIVE_CHAT', 1],
    ]);
    expect(s.byAgent[0]).toMatchObject({ name: 'Ann', firstReplies: 2 });
    expect(s.byAgent[1]).toMatchObject({
      name: 'Bob',
      medianFirstResponseSeconds: 300,
    });
  });

  it('never reports a negative time if clocks disagree', () => {
    const s = summarizeFirstResponses([
      row({ firstReplyAt: at('2026-10-20T09:59:00Z') }),
    ]);
    expect(s.firstResponse.medianSeconds).toBe(0);
  });
});

describe('fillDaily', () => {
  it('includes quiet days in order', () => {
    const daily = new Map([['2026-10-20', 3]]);
    expect(fillDaily(daily, at('2026-10-19T00:00:00Z'), 3)).toEqual([
      { date: '2026-10-19', conversations: 0 },
      { date: '2026-10-20', conversations: 3 },
      { date: '2026-10-21', conversations: 0 },
    ]);
  });
});

describe('summarizeByTag', () => {
  const link = (conversationId: string, tagId: string, tagName = tagId) => ({
    conversationId,
    tagId,
    tagName,
    tagColor: '#000',
  });

  it('counts each tagged conversation under every tag it has, with response times', () => {
    const rows = [
      row({ conversationId: '1' }), // answered after 60s
      row({ conversationId: '2', firstReplyAt: at('2026-10-20T10:03:00Z') }), // 180s
      row({ conversationId: '3', firstReplyAt: null, replyMemberId: null }),
      row({ conversationId: '4' }),
    ];
    const { tags, untagged } = summarizeByTag(rows, [
      link('1', 'refund', 'Refund'),
      link('2', 'refund', 'Refund'),
      link('3', 'refund', 'Refund'),
      link('2', 'vip', 'VIP'),
    ]);
    expect(
      tags.map((t) => [
        t.name,
        t.conversations,
        t.answered,
        t.unanswered,
        t.medianFirstResponseSeconds,
      ]),
    ).toEqual([
      ['Refund', 3, 2, 1, 120],
      ['VIP', 1, 1, 0, 180],
    ]);
    expect(untagged).toBe(1); // conversation 4
  });

  it('ignores tag links for conversations outside the period', () => {
    const { tags, untagged } = summarizeByTag(
      [row({ conversationId: '1' })],
      [link('elsewhere', 'x')],
    );
    expect(tags).toEqual([]);
    expect(untagged).toBe(1);
  });
});
