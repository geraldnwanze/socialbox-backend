/** Pure aggregation helpers, kept free of the database so they can be unit tested. */

export interface FirstResponseRow {
  conversationId: string;
  channelConnectionId: string;
  channelType: string;
  channelName: string | null;
  firstInboundAt: Date;
  /** Null when no agent has replied yet. */
  firstReplyAt: Date | null;
  replyMemberId: string | null;
  replyMemberName: string | null;
}

export interface Distribution {
  count: number;
  avgSeconds: number | null;
  medianSeconds: number | null;
  p90Seconds: number | null;
}

/** Linear-interpolated percentile (p in 0..1) of an ascending-sorted list. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = (sorted.length - 1) * p;
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

const round = (n: number | null) => (n === null ? null : Math.round(n));

export function distribution(values: number[]): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    avgSeconds: sorted.length ? round(sum / sorted.length) : null,
    medianSeconds: round(percentile(sorted, 0.5)),
    p90Seconds: round(percentile(sorted, 0.9)),
  };
}

const secondsBetween = (a: Date, b: Date) =>
  Math.max(0, (b.getTime() - a.getTime()) / 1000);

export function summarizeFirstResponses(rows: FirstResponseRow[]) {
  const answered = rows.filter((r) => r.firstReplyAt);
  const times = (list: FirstResponseRow[]) =>
    list.map((r) => secondsBetween(r.firstInboundAt, r.firstReplyAt as Date));

  const byChannel = new Map<string, FirstResponseRow[]>();
  const byAgent = new Map<string, FirstResponseRow[]>();
  for (const row of rows) {
    byChannel.set(row.channelConnectionId, [
      ...(byChannel.get(row.channelConnectionId) ?? []),
      row,
    ]);
    if (row.firstReplyAt && row.replyMemberId) {
      byAgent.set(row.replyMemberId, [
        ...(byAgent.get(row.replyMemberId) ?? []),
        row,
      ]);
    }
  }

  const daily = new Map<string, number>();
  for (const row of rows) {
    const day = row.firstInboundAt.toISOString().slice(0, 10);
    daily.set(day, (daily.get(day) ?? 0) + 1);
  }

  return {
    conversations: rows.length,
    answered: answered.length,
    unanswered: rows.length - answered.length,
    firstResponse: distribution(times(answered)),
    daily,
    byChannel: [...byChannel.entries()]
      .map(([channelConnectionId, list]) => {
        const done = list.filter((r) => r.firstReplyAt);
        return {
          channelConnectionId,
          type: list[0].channelType,
          name: list[0].channelName,
          conversations: list.length,
          answered: done.length,
          medianFirstResponseSeconds: distribution(times(done)).medianSeconds,
        };
      })
      .sort((a, b) => b.conversations - a.conversations),
    byAgent: [...byAgent.entries()]
      .map(([memberId, list]) => ({
        memberId,
        name: list[0].replyMemberName,
        firstReplies: list.length,
        medianFirstResponseSeconds: distribution(times(list)).medianSeconds,
      }))
      .sort((a, b) => b.firstReplies - a.firstReplies),
  };
}

/** Fills days with no activity so charts do not skip them. `from` is inclusive, `days` long. */
export function fillDaily(
  daily: Map<string, number>,
  from: Date,
  days: number,
): { date: string; conversations: number }[] {
  const out: { date: string; conversations: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from.getTime() + i * 86_400_000);
    const date = d.toISOString().slice(0, 10);
    out.push({ date, conversations: daily.get(date) ?? 0 });
  }
  return out;
}
