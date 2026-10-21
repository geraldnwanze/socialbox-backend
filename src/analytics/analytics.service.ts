import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  FirstResponseRow,
  distribution,
  fillDaily,
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
    };
  }
}
