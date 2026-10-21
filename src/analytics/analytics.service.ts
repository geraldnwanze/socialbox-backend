import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  FirstResponseRow,
  TagLink,
  distribution,
  fillDaily,
  summarizeByTag,
  summarizeFirstResponses,
} from './analytics.summary';

interface RawFirstResponse {
  conversation_id: string;
  channel_connection_id: string;
  channel_type: string;
  channel_name: string | null;
  first_inbound_at: Date;
  first_reply_at: Date | null;
  reply_member_id: string | null;
  reply_member_name: string | null;
}

@Injectable()
export class AnalyticsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Stats for conversations whose first customer message landed in the last `days` days (UTC).
   * Times are wall-clock — there is no business-hours calendar — and the first *agent* reply
   * counts (automatic/system messages are ignored; failed sends too).
   */
  async overview(workspaceId: string, days: number, now = new Date()) {
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const from = new Date(todayStart.getTime() - (days - 1) * 86_400_000);
    const to = new Date(todayStart.getTime() + 86_400_000);

    const [firstResponseRows, resolved, volume] = await Promise.all([
      this.dataSource.query<RawFirstResponse[]>(
        `WITH first_in AS (
           SELECT m.conversation_id, MIN(m.sent_at) AS at
           FROM messages m
           WHERE m.workspace_id = $1 AND m.direction = 'INBOUND'
           GROUP BY m.conversation_id
           HAVING MIN(m.sent_at) >= $2 AND MIN(m.sent_at) < $3
         )
         SELECT f.conversation_id, c.channel_connection_id,
                cc.type AS channel_type, cc.external_account_name AS channel_name,
                f.at AS first_inbound_at, r.sent_at AS first_reply_at,
                r.sender_member_id AS reply_member_id, u.full_name AS reply_member_name
         FROM first_in f
         JOIN conversations c ON c.id = f.conversation_id
         JOIN channel_connections cc ON cc.id = c.channel_connection_id
         LEFT JOIN LATERAL (
           SELECT sent_at, sender_member_id FROM messages
           WHERE conversation_id = f.conversation_id AND direction = 'OUTBOUND'
             AND sender_type = 'AGENT' AND status <> 'FAILED' AND sent_at > f.at
           ORDER BY sent_at LIMIT 1
         ) r ON true
         LEFT JOIN workspace_members wm ON wm.id = r.sender_member_id
         LEFT JOIN users u ON u.id = wm.user_id`,
        [workspaceId, from, to],
      ),
      this.dataSource.query<{ seconds: string }[]>(
        `SELECT EXTRACT(EPOCH FROM (resolved_at - created_at)) AS seconds
         FROM conversations
         WHERE workspace_id = $1 AND resolved_at >= $2 AND resolved_at < $3`,
        [workspaceId, from, to],
      ),
      this.dataSource.query<{ direction: string; count: string }[]>(
        `SELECT direction, COUNT(*) AS count FROM messages
         WHERE workspace_id = $1 AND sent_at >= $2 AND sent_at < $3
           AND message_type <> 'SYSTEM'
         GROUP BY direction`,
        [workspaceId, from, to],
      ),
    ]);

    const summary = summarizeFirstResponses(
      firstResponseRows.map((r): FirstResponseRow => ({
        conversationId: r.conversation_id,
        channelConnectionId: r.channel_connection_id,
        channelType: r.channel_type,
        channelName: r.channel_name,
        firstInboundAt: new Date(r.first_inbound_at),
        firstReplyAt: r.first_reply_at ? new Date(r.first_reply_at) : null,
        replyMemberId: r.reply_member_id,
        replyMemberName: r.reply_member_name,
      })),
    );
    const rows = firstResponseRows.map((r): FirstResponseRow => ({
      conversationId: r.conversation_id,
      channelConnectionId: r.channel_connection_id,
      channelType: r.channel_type,
      channelName: r.channel_name,
      firstInboundAt: new Date(r.first_inbound_at),
      firstReplyAt: r.first_reply_at ? new Date(r.first_reply_at) : null,
      replyMemberId: r.reply_member_id,
      replyMemberName: r.reply_member_name,
    }));
    const [tagLinks, workload] = await Promise.all([
      this.tagLinks(rows.map((r) => r.conversationId)),
      this.workload(workspaceId, from, to, summary.byAgent),
    ]);
    const byTag = summarizeByTag(rows, tagLinks);
    const count = (direction: string) =>
      Number(volume.find((v) => v.direction === direction)?.count ?? 0);

    return {
      range: { days, from: from.toISOString(), to: to.toISOString() },
      totals: {
        newConversations: summary.conversations,
        answered: summary.answered,
        unanswered: summary.unanswered,
        resolved: resolved.length,
        inboundMessages: count('INBOUND'),
        outboundMessages: count('OUTBOUND'),
      },
      firstResponse: summary.firstResponse,
      resolution: distribution(resolved.map((r) => Number(r.seconds))),
      daily: fillDaily(summary.daily, from, days),
      byChannel: summary.byChannel,
      byAgent: summary.byAgent,
      byTag: byTag.tags,
      untagged: byTag.untagged,
      workload,
    };
  }

  private async tagLinks(conversationIds: string[]): Promise<TagLink[]> {
    if (conversationIds.length === 0) return [];
    const rows = await this.dataSource.query<
      { conversation_id: string; tag_id: string; name: string; color: string }[]
    >(
      `SELECT ct.conversation_id, t.id AS tag_id, t.name, t.color
       FROM conversation_tags ct JOIN tags t ON t.id = ct.tag_id
       WHERE ct.conversation_id = ANY($1::uuid[])`,
      [conversationIds],
    );
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      tagId: r.tag_id,
      tagName: r.name,
      tagColor: r.color,
    }));
  }

  /**
   * Who is carrying what *right now* (open/pending conversations by owner, what is waiting on a
   * reply and for how long) plus what each person got done in the selected period.
   */
  private async workload(
    workspaceId: string,
    from: Date,
    to: Date,
    byAgent: { memberId: string; medianFirstResponseSeconds: number | null }[],
  ) {
    const [members, snapshot, resolved, sent] = await Promise.all([
      this.dataSource.query<{ id: string; full_name: string }[]>(
        `SELECT m.id, u.full_name FROM workspace_members m JOIN users u ON u.id = m.user_id
         WHERE m.workspace_id = $1 ORDER BY u.full_name`,
        [workspaceId],
      ),
      // "Waiting on a reply" = the latest message that actually went through is the customer's.
      this.dataSource.query<
        {
          member_id: string | null;
          open: string;
          pending: string;
          unread: string;
          awaiting_reply: string;
          oldest_waiting_since: Date | null;
          high_priority: string;
        }[]
      >(
        `SELECT c.assigned_to AS member_id,
           COUNT(*) FILTER (WHERE c.status = 'OPEN') AS open,
           COUNT(*) FILTER (WHERE c.status = 'PENDING') AS pending,
           COUNT(*) FILTER (WHERE c.unread_count > 0) AS unread,
           COUNT(*) FILTER (WHERE c.status = 'OPEN' AND lm.direction = 'INBOUND') AS awaiting_reply,
           MIN(lm.sent_at) FILTER (WHERE c.status = 'OPEN' AND lm.direction = 'INBOUND') AS oldest_waiting_since,
           COUNT(*) FILTER (WHERE c.priority IN ('HIGH', 'URGENT')) AS high_priority
         FROM conversations c
         LEFT JOIN LATERAL (
           SELECT direction, sent_at FROM messages
           WHERE conversation_id = c.id AND status <> 'FAILED' AND message_type <> 'SYSTEM'
           ORDER BY sent_at DESC LIMIT 1
         ) lm ON true
         WHERE c.workspace_id = $1 AND c.status <> 'RESOLVED'
         GROUP BY c.assigned_to`,
        [workspaceId],
      ),
      this.dataSource.query<{ actor_member_id: string; count: string }[]>(
        `SELECT actor_member_id, COUNT(*) AS count FROM conversation_events
         WHERE workspace_id = $1 AND type = 'STATUS_CHANGED' AND data->>'to' = 'RESOLVED'
           AND actor_member_id IS NOT NULL AND created_at >= $2 AND created_at < $3
         GROUP BY actor_member_id`,
        [workspaceId, from, to],
      ),
      this.dataSource.query<{ sender_member_id: string; count: string }[]>(
        `SELECT sender_member_id, COUNT(*) AS count FROM messages
         WHERE workspace_id = $1 AND direction = 'OUTBOUND' AND sender_type = 'AGENT'
           AND status <> 'FAILED' AND sender_member_id IS NOT NULL
           AND sent_at >= $2 AND sent_at < $3
         GROUP BY sender_member_id`,
        [workspaceId, from, to],
      ),
    ]);

    const num = (v: string | undefined) => Number(v ?? 0);
    const snap = new Map(snapshot.map((r) => [r.member_id, r]));
    const toRow = (memberId: string | null, name: string) => {
      const s = snap.get(memberId);
      return {
        memberId,
        name,
        open: num(s?.open),
        pending: num(s?.pending),
        unread: num(s?.unread),
        awaitingReply: num(s?.awaiting_reply),
        oldestWaitingSince: s?.oldest_waiting_since
          ? new Date(s.oldest_waiting_since).toISOString()
          : null,
        highPriority: num(s?.high_priority),
        resolved: num(
          resolved.find((r) => r.actor_member_id === memberId)?.count,
        ),
        messagesSent: num(
          sent.find((r) => r.sender_member_id === memberId)?.count,
        ),
        medianFirstResponseSeconds:
          byAgent.find((a) => a.memberId === memberId)
            ?.medianFirstResponseSeconds ?? null,
      };
    };

    const team = members.map((m) => toRow(m.id, m.full_name));
    const unassigned = toRow(null, 'Unassigned');
    const everyone = [unassigned, ...team];
    return {
      members: team.sort(
        (a, b) =>
          b.open + b.pending - (a.open + a.pending) ||
          a.name.localeCompare(b.name),
      ),
      unassigned,
      backlog: {
        awaitingReply: everyone.reduce((n, r) => n + r.awaitingReply, 0),
        oldestWaitingSince:
          everyone
            .map((r) => r.oldestWaitingSince)
            .filter((d): d is string => !!d)
            .sort()[0] ?? null,
      },
    };
  }
}
