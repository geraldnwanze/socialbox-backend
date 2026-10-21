import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { ChannelConnection } from '../src/channels/entities/channel-connection.entity';
import {
  ChannelConnectionStatus,
  ChannelType,
} from '../src/channels/enums/channel-type.enum';
import { Contact } from '../src/contacts/entities/contact.entity';
import { ContactIdentity } from '../src/contacts/entities/contact-identity.entity';
import { Conversation } from '../src/conversations/entities/conversation.entity';
import { Message } from '../src/messages/entities/message.entity';
import {
  MessageDirection,
  MessageStatus,
  MessageType,
  SenderType,
} from '../src/messages/enums/message.enums';

describe('Features (e2e): saved replies, contacts, analytics, email', () => {
  let app: INestApplication;
  let db: DataSource;
  const password = 'password123';
  const stamp = Date.now();

  let owner: string;
  let agent: string;
  let outsider: string;
  let ws: string;
  let otherWs: string;

  const api = () => request(app.getHttpServer());
  const as = (token: string, workspaceId = ws) => ({
    authorization: `Bearer ${token}`,
    'x-workspace-id': workspaceId,
  });

  async function register(label: string) {
    const res = await api()
      .post('/auth/register')
      .send({
        email: `e2e-${label}-${stamp}@example.com`,
        password,
        fullName: label,
      })
      .expect(201);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        // Same as src/main.ts: the e2e app must validate exactly like production does.
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    db = app.get(DataSource);

    owner = await register('owner');
    agent = await register('agent');
    outsider = await register('outsider');

    ws = (
      await api()
        .post('/workspaces')
        .set('authorization', `Bearer ${owner}`)
        .send({ name: 'Features WS' })
        .expect(201)
    ).body.id;
    otherWs = (
      await api()
        .post('/workspaces')
        .set('authorization', `Bearer ${outsider}`)
        .send({ name: 'Other WS' })
        .expect(201)
    ).body.id;
    await api()
      .post('/workspace/members')
      .set(as(owner))
      .send({ email: `e2e-agent-${stamp}@example.com`, role: 'AGENT' })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('saved replies', () => {
    let replyId: string;

    it('lets an admin create one, normalizing the shortcut', async () => {
      const res = await api()
        .post('/canned-responses')
        .set(as(owner))
        .send({
          title: 'Shipping',
          shortcut: '/Ship ',
          content: 'Hi {{customer_name}}!',
        })
        .expect(201);
      expect(res.body.shortcut).toBe('ship');
      replyId = res.body.id;
    });

    it('rejects a duplicate shortcut (409) and invalid input (400)', async () => {
      await api()
        .post('/canned-responses')
        .set(as(owner))
        .send({ title: 'Dup', shortcut: 'ship', content: 'x' })
        .expect(409);
      await api()
        .post('/canned-responses')
        .set(as(owner))
        .send({ title: 'Bad', shortcut: 'no spaces', content: 'x' })
        .expect(400);
      await api()
        .post('/canned-responses')
        .set(as(owner))
        .send({ title: 'Empty', shortcut: 'empty', content: '' })
        .expect(400);
    });

    it('lets agents read but not change them', async () => {
      const list = await api()
        .get('/canned-responses')
        .set(as(agent))
        .expect(200);
      expect(list.body.map((r: { shortcut: string }) => r.shortcut)).toEqual([
        'ship',
      ]);
      await api()
        .post('/canned-responses')
        .set(as(agent))
        .send({ title: 'T', shortcut: 'agentmade', content: 'x' })
        .expect(403);
      await api()
        .delete(`/canned-responses/${replyId}`)
        .set(as(agent))
        .expect(403);
    });

    it('is isolated per workspace', async () => {
      const other = await api()
        .get('/canned-responses')
        .set(as(outsider, otherWs))
        .expect(200);
      expect(other.body).toEqual([]);
      await api()
        .patch(`/canned-responses/${replyId}`)
        .set(as(outsider, otherWs))
        .send({ title: 'Hijack' })
        .expect(404);
      await api().get('/canned-responses').set(as(outsider, ws)).expect(403);
    });

    it('updates and deletes', async () => {
      const res = await api()
        .patch(`/canned-responses/${replyId}`)
        .set(as(owner))
        .send({ title: 'Shipping times' })
        .expect(200);
      expect(res.body).toMatchObject({
        title: 'Shipping times',
        shortcut: 'ship',
      });
      await api()
        .delete(`/canned-responses/${replyId}`)
        .set(as(owner))
        .expect(200);
      expect(
        (await api().get('/canned-responses').set(as(owner))).body,
      ).toEqual([]);
    });
  });

  describe('contacts and merge', () => {
    let connection: ChannelConnection;
    let target: Contact;
    let source: Contact;
    let sourceConversation: Conversation;

    beforeAll(async () => {
      connection = await db.getRepository(ChannelConnection).save({
        workspaceId: ws,
        type: ChannelType.TELEGRAM,
        provider: 'TelegramAdapter',
        status: ChannelConnectionStatus.CONNECTED,
        externalAccountId: `bot-${stamp}`,
        metadata: {},
      });
      const contacts = db.getRepository(Contact);
      target = await contacts.save({
        workspaceId: ws,
        displayName: 'Ann',
        notes: 'VIP',
      });
      source = await contacts.save({
        workspaceId: ws,
        displayName: 'Ann (duplicate)',
        email: 'ann@example.com',
        notes: 'Prefers email',
      });
      await db.getRepository(ContactIdentity).save({
        contactId: source.id,
        workspaceId: ws,
        channel: ChannelType.TELEGRAM,
        channelConnectionId: connection.id,
        externalUserId: `tg-${stamp}`,
        metadata: {},
      });
      sourceConversation = await db.getRepository(Conversation).save({
        workspaceId: ws,
        channelConnectionId: connection.id,
        contactId: source.id,
        externalConversationId: `tg-${stamp}`,
      });
    });

    it('edits details, clears fields, and validates', async () => {
      const res = await api()
        .patch(`/contacts/${target.id}`)
        .set(as(agent))
        .send({ phone: ' 555 ', notes: '' })
        .expect(200);
      expect(res.body).toMatchObject({
        phone: '555',
        notes: null,
        displayName: 'Ann',
      });
      await api()
        .patch(`/contacts/${target.id}`)
        .set(as(owner))
        .send({ email: 'not-an-email' })
        .expect(400);
      await api()
        .patch(`/contacts/${target.id}`)
        .set(as(owner))
        .send({ displayName: '' })
        .expect(400);
      await api()
        .patch(`/contacts/${target.id}`)
        .set(as(owner))
        .send({ notes: 'VIP' })
        .expect(200);
    });

    it('keeps contacts private to their workspace', async () => {
      await api()
        .get(`/contacts/${target.id}`)
        .set(as(outsider, otherWs))
        .expect(404);
      await api()
        .patch(`/contacts/${target.id}`)
        .set(as(outsider, otherWs))
        .send({ phone: '1' })
        .expect(404);
    });

    it('only lets admins merge, and never across workspaces or into itself', async () => {
      const body = { sourceContactId: source.id };
      await api()
        .post(`/contacts/${target.id}/merge`)
        .set(as(agent))
        .send(body)
        .expect(403);
      await api()
        .post(`/contacts/${target.id}/merge`)
        .set(as(owner))
        .send({ sourceContactId: target.id })
        .expect(400);
      await api()
        .post(`/contacts/${target.id}/merge`)
        .set(as(outsider, otherWs))
        .send(body)
        .expect(404);
    });

    it('merges: moves identities and conversations, fills blanks, removes the duplicate', async () => {
      const res = await api()
        .post(`/contacts/${target.id}/merge`)
        .set(as(owner))
        .send({ sourceContactId: source.id })
        .expect(201);
      expect(res.body).toMatchObject({
        email: 'ann@example.com',
        phone: '555',
      });
      expect(res.body.notes).toBe('VIP\n\nPrefers email');
      expect(res.body.identities).toHaveLength(1);

      const convs = await api()
        .get(`/contacts/${target.id}/conversations`)
        .set(as(owner))
        .expect(200);
      expect(convs.body.map((c: { id: string }) => c.id)).toEqual([
        sourceConversation.id,
      ]);
      await api().get(`/contacts/${source.id}`).set(as(owner)).expect(404);
    });
  });

  describe('analytics', () => {
    it('is admin-only and validates the range', async () => {
      await api().get('/analytics/overview').set(as(agent)).expect(403);
      await api().get('/analytics/overview?days=5').set(as(owner)).expect(400);
    });

    it('computes first-response and resolution times from real messages', async () => {
      const connection = await db.getRepository(ChannelConnection).save({
        workspaceId: ws,
        type: ChannelType.LIVE_CHAT,
        provider: 'LiveChatAdapter',
        status: ChannelConnectionStatus.CONNECTED,
        externalAccountId: `wk_${stamp}`,
        metadata: {},
      });
      const contact = await db
        .getRepository(Contact)
        .save({ workspaceId: ws, displayName: 'Visitor' });
      const base = Date.now() - 60 * 60 * 1000;
      const members = await api()
        .get('/workspace/members')
        .set(as(owner))
        .expect(200);
      const memberId = members.body.find(
        (m: { role: string }) => m.role === 'OWNER',
      ).id;

      const mk = async (key: string, replyAfterSec?: number) => {
        const conversation = await db.getRepository(Conversation).save({
          workspaceId: ws,
          channelConnectionId: connection.id,
          contactId: contact.id,
          externalConversationId: key,
        });
        const message = (over: Partial<Message>) =>
          db.getRepository(Message).save({
            workspaceId: ws,
            conversationId: conversation.id,
            channelConnectionId: connection.id,
            messageType: MessageType.TEXT,
            metadata: {},
            ...over,
          });
        await message({
          direction: MessageDirection.INBOUND,
          senderType: SenderType.CONTACT,
          status: MessageStatus.RECEIVED,
          sentAt: new Date(base),
          content: 'hi',
          externalMessageId: `${key}-in`,
        });
        if (replyAfterSec !== undefined) {
          await message({
            direction: MessageDirection.OUTBOUND,
            senderType: SenderType.AGENT,
            senderMemberId: memberId,
            status: MessageStatus.SENT,
            sentAt: new Date(base + replyAfterSec * 1000),
            content: 'hello',
            externalMessageId: `${key}-out`,
          });
        }
        return conversation;
      };

      await mk('a', 60);
      await mk('b', 180);
      const unanswered = await mk('c');
      // A failed reply must not count as a response.
      await db.getRepository(Message).save({
        workspaceId: ws,
        conversationId: unanswered.id,
        channelConnectionId: connection.id,
        messageType: MessageType.TEXT,
        metadata: {},
        direction: MessageDirection.OUTBOUND,
        senderType: SenderType.AGENT,
        senderMemberId: memberId,
        status: MessageStatus.FAILED,
        sentAt: new Date(base + 30_000),
        content: 'oops',
        externalMessageId: 'c-failed',
      });

      await api()
        .post(`/conversations/${(await mk('d', 10)).id}/resolve`)
        .set(as(owner))
        .expect(201);

      const res = await api()
        .get('/analytics/overview?days=7')
        .set(as(owner))
        .expect(200);
      expect(res.body.totals).toMatchObject({
        newConversations: 4,
        answered: 3,
        unanswered: 1,
        resolved: 1,
      });
      expect(res.body.firstResponse).toMatchObject({
        count: 3,
        medianSeconds: 60,
        avgSeconds: 83,
      });
      expect(res.body.resolution.count).toBe(1);
      expect(res.body.byAgent[0]).toMatchObject({ memberId, firstReplies: 3 });
      expect(res.body.daily).toHaveLength(7);
    });

    it("does not leak another workspace's numbers", async () => {
      const res = await api()
        .get('/analytics/overview?days=7')
        .set(as(outsider, otherWs))
        .expect(200);
      expect(res.body.totals.newConversations).toBe(0);
    });
  });

  describe('email channel connect (security)', () => {
    const connect = (credentials: Record<string, unknown>) =>
      api()
        .post('/channels/EMAIL/connect')
        .set(as(owner))
        .send({ credentials });
    const base = {
      email: 'a@example.com',
      password: 'x',
      smtpHost: 'smtp.example.com',
    };

    it('refuses to be pointed at internal network addresses', async () => {
      for (const imapHost of ['127.0.0.1', '169.254.169.254', '10.0.0.5']) {
        const res = await connect({ ...base, imapHost }).expect(400);
        expect(res.body.message).toContain('private network');
      }
    });

    it('refuses unencrypted transport and bad input', async () => {
      const plain = await connect({
        ...base,
        imapHost: 'imap.example.com',
        imapSecurity: 'NONE',
      }).expect(400);
      expect(plain.body.message).toContain('Unencrypted');
      await connect({
        ...base,
        email: 'nope',
        imapHost: 'imap.example.com',
      }).expect(400);
    });

    it('is admin-only', async () => {
      await api()
        .post('/channels/EMAIL/connect')
        .set(as(agent))
        .send({ credentials: base })
        .expect(403);
    });
  });

  describe('live chat settings and public endpoints', () => {
    const connect = (credentials: Record<string, unknown>) =>
      api()
        .post('/channels/LIVE_CHAT/connect')
        .set(as(owner))
        .send({ credentials });
    let widgetKey: string;

    it('rejects an invalid time zone or hours', async () => {
      const tz = await connect({
        hoursEnabled: 'true',
        timezone: 'Mars/Base',
      }).expect(400);
      expect(tz.body.message).toContain('time zone');
      const hours = await connect({
        hoursEnabled: 'true',
        hoursStart: '17:00',
        hoursEnd: '09:00',
      }).expect(400);
      expect(hours.body.message).toContain('later than');
    });

    it('reports online/offline and the pre-chat settings in the public config', async () => {
      const res = await connect({
        title: 'Support',
        askName: 'true',
        askEmail: 'true',
        hoursEnabled: 'true',
        timezone: 'UTC',
        hoursDays: '0,1,2,3,4,5,6',
        hoursStart: '00:00',
        hoursEnd: '23:59',
      }).expect(201);
      widgetKey = res.body.externalAccountId;
      const open = await api().get(`/widget/${widgetKey}/config`).expect(200);
      expect(open.body).toMatchObject({
        askName: true,
        askEmail: true,
        online: true,
      });

      // Reconnecting keeps the key; an always-closed schedule flips it offline.
      await connect({
        hoursEnabled: 'true',
        hoursDays: '',
        hoursStart: '09:00',
        hoursEnd: '17:00',
      }).expect(400);
      await connect({
        hoursEnabled: 'true',
        hoursDays: '0',
        hoursStart: '00:00',
        hoursEnd: '00:01',
        timezone: 'UTC',
      }).expect(201);
      const closed = await api().get(`/widget/${widgetKey}/config`).expect(200);
      expect(closed.body.online).toBe(false);
    });

    it('requires a visitor token for typing, uploads and polling', async () => {
      await api().post('/widget/typing').expect(401);
      await api().get('/widget/messages').expect(401);
      await api()
        .post('/widget/messages/upload')
        .field('id', 'abcdefgh1')
        .attach('file', Buffer.from('x'), 'a.txt')
        .expect(401);
    });

    it('only lets agents of the same workspace signal presence and typing', async () => {
      const conn = await db
        .getRepository(ChannelConnection)
        .findOneByOrFail({ externalAccountId: widgetKey });
      const contact = await db
        .getRepository(Contact)
        .save({ workspaceId: ws, displayName: 'Typist' });
      const conversation = await db.getRepository(Conversation).save({
        workspaceId: ws,
        channelConnectionId: conn.id,
        contactId: contact.id,
        externalConversationId: 'typing-visitor',
      });
      const res = await api()
        .post(`/conversations/${conversation.id}/presence`)
        .set(as(agent))
        .send({ typing: true })
        .expect(201);
      expect(res.body.viewers).toMatchObject([{ name: 'agent', typing: true }]);
      await api()
        .post(`/conversations/${conversation.id}/presence`)
        .set(as(outsider, otherWs))
        .send({})
        .expect(404);
    });
  });

  describe('read receipts', () => {
    it('is on by default and only admins can change it', async () => {
      const list = await api()
        .get('/workspaces')
        .set('authorization', `Bearer ${owner}`)
        .expect(200);
      expect(
        list.body.find((w: { id: string }) => w.id === ws).sendReadReceipts,
      ).toBe(true);

      await api()
        .patch('/workspace/settings')
        .set(as(agent))
        .send({ sendReadReceipts: false })
        .expect(403);
      const off = await api()
        .patch('/workspace/settings')
        .set(as(owner))
        .send({ sendReadReceipts: false })
        .expect(200);
      expect(off.body.sendReadReceipts).toBe(false);
      await api()
        .patch('/workspace/settings')
        .set(as(owner))
        .send({ sendReadReceipts: true })
        .expect(200);
    });

    it('rejects values that are not real booleans (no implicit "false" -> true)', async () => {
      await api()
        .patch('/workspace/settings')
        .set(as(owner))
        .send({ sendReadReceipts: 'false' })
        .expect(400);
      await api()
        .patch('/workspace/settings')
        .set(as(owner))
        .send({ sendReadReceipts: 'yes' })
        .expect(400);
    });

    it("opening a conversation marks the customer's messages read, once", async () => {
      const conn = await db.getRepository(ChannelConnection).save({
        workspaceId: ws,
        type: ChannelType.TELEGRAM,
        provider: 'TelegramAdapter',
        status: ChannelConnectionStatus.CONNECTED,
        externalAccountId: `bot-read-${stamp}`,
        metadata: {},
      });
      const contact = await db
        .getRepository(Contact)
        .save({ workspaceId: ws, displayName: 'Reader' });
      const conversation = await db.getRepository(Conversation).save({
        workspaceId: ws,
        channelConnectionId: conn.id,
        contactId: contact.id,
        externalConversationId: `read-${stamp}`,
        unreadCount: 2,
      });
      const messages = db.getRepository(Message);
      for (const [i, direction] of [
        MessageDirection.INBOUND,
        MessageDirection.INBOUND,
        MessageDirection.OUTBOUND,
      ].entries()) {
        await messages.save({
          workspaceId: ws,
          conversationId: conversation.id,
          channelConnectionId: conn.id,
          messageType: MessageType.TEXT,
          metadata: {},
          direction,
          senderType:
            direction === MessageDirection.INBOUND
              ? SenderType.CONTACT
              : SenderType.AGENT,
          status:
            direction === MessageDirection.INBOUND
              ? MessageStatus.RECEIVED
              : MessageStatus.SENT,
          sentAt: new Date(Date.now() - (3 - i) * 1000),
          content: `m${i}`,
          externalMessageId: `read-${stamp}-${i}`,
        });
      }

      const res = await api()
        .patch(`/conversations/${conversation.id}`)
        .set(as(agent))
        .send({ read: true })
        .expect(200);
      expect(res.body.unreadCount).toBe(0);
      const rows = await messages.find({
        where: { conversationId: conversation.id },
        order: { sentAt: 'ASC' },
      });
      expect(rows.map((m) => [m.direction, m.status])).toEqual([
        ['INBOUND', 'READ'],
        ['INBOUND', 'READ'],
        ['OUTBOUND', 'SENT'], // our own messages are untouched
      ]);
      await api()
        .patch(`/conversations/${conversation.id}`)
        .set(as(outsider, otherWs))
        .send({ read: true })
        .expect(404);
    });
  });

  describe('collision detection (presence)', () => {
    it('shows teammates who has a conversation open, and removes them when they leave', async () => {
      const conn = await db.getRepository(ChannelConnection).save({
        workspaceId: ws,
        type: ChannelType.TELEGRAM,
        provider: 'TelegramAdapter',
        status: ChannelConnectionStatus.CONNECTED,
        externalAccountId: `bot-presence-${stamp}`,
        metadata: {},
      });
      const contact = await db
        .getRepository(Contact)
        .save({ workspaceId: ws, displayName: 'Customer' });
      const conversation = await db.getRepository(Conversation).save({
        workspaceId: ws,
        channelConnectionId: conn.id,
        contactId: contact.id,
        externalConversationId: `presence-${stamp}`,
      });
      const url = `/conversations/${conversation.id}/presence`;

      await api().post(url).set(as(owner)).send({}).expect(201);
      const both = await api()
        .post(url)
        .set(as(agent))
        .send({ typing: true })
        .expect(201);
      expect(
        both.body.viewers
          .map((v: { name: string; typing: boolean }) => [v.name, v.typing])
          .sort(),
      ).toEqual([
        ['agent', true],
        ['owner', false],
      ]);

      await api().delete(url).set(as(agent)).expect(204);
      const after = await api().post(url).set(as(owner)).send({}).expect(201);
      expect(after.body.viewers.map((v: { name: string }) => v.name)).toEqual([
        'owner',
      ]);

      await api()
        .post(url)
        .set(as(owner))
        .send({ typing: 'false' })
        .expect(400);
      await api()
        .post('/conversations/not-a-uuid/presence')
        .set(as(owner))
        .send({})
        .expect(400);
    });
  });

  describe('conversation activity, priority and notes', () => {
    let conversationId: string;
    let agentMemberId: string;
    let outsiderMemberId: string;

    const events = async (token = owner) =>
      (
        await api()
          .get(`/conversations/${conversationId}/events`)
          .set(as(token))
          .expect(200)
      ).body as {
        type: string;
        data: Record<string, unknown>;
        actor: { name: string } | null;
      }[];

    beforeAll(async () => {
      const conn = await db.getRepository(ChannelConnection).save({
        workspaceId: ws,
        type: ChannelType.TELEGRAM,
        provider: 'TelegramAdapter',
        status: ChannelConnectionStatus.CONNECTED,
        externalAccountId: `bot-activity-${stamp}`,
        metadata: {},
      });
      const contact = await db
        .getRepository(Contact)
        .save({ workspaceId: ws, displayName: 'Activity' });
      const conversation = await db.getRepository(Conversation).save({
        workspaceId: ws,
        channelConnectionId: conn.id,
        contactId: contact.id,
        externalConversationId: `activity-${stamp}`,
      });
      conversationId = conversation.id;
      const members = await api()
        .get('/workspace/members')
        .set(as(owner))
        .expect(200);
      agentMemberId = members.body.find(
        (m: { role: string }) => m.role === 'AGENT',
      ).id;
      const others = await api()
        .get('/workspace/members')
        .set(as(outsider, otherWs))
        .expect(200);
      outsiderMemberId = others.body[0].id;
    });

    it('records who assigned the conversation, once per real change', async () => {
      await api()
        .post(`/conversations/${conversationId}/assign`)
        .set(as(owner))
        .send({ assigneeMemberId: agentMemberId })
        .expect(201);
      await api()
        .post(`/conversations/${conversationId}/assign`)
        .set(as(owner))
        .send({ assigneeMemberId: agentMemberId })
        .expect(201);
      const list = await events();
      const assigned = list.filter((e) => e.type === 'ASSIGNED');
      expect(assigned).toHaveLength(1);
      expect(assigned[0]).toMatchObject({
        data: { toName: 'agent' },
        actor: { name: 'owner' },
      });

      await api()
        .post(`/conversations/${conversationId}/assign`)
        .set(as(owner))
        .send({})
        .expect(201);
      expect(
        (await events()).filter((e) => e.type === 'UNASSIGNED'),
      ).toHaveLength(1);
    });

    it('refuses to assign to someone from another workspace', async () => {
      await api()
        .post(`/conversations/${conversationId}/assign`)
        .set(as(owner))
        .send({ assigneeMemberId: outsiderMemberId })
        .expect(404);
      const conv = await db
        .getRepository(Conversation)
        .findOneByOrFail({ id: conversationId });
      expect(conv.assignedTo ?? null).toBeNull();
    });

    it('records status changes with the agent, and nothing when the status did not change', async () => {
      await api()
        .post(`/conversations/${conversationId}/resolve`)
        .set(as(agent))
        .expect(201);
      await api()
        .post(`/conversations/${conversationId}/resolve`)
        .set(as(agent))
        .expect(201);
      await api()
        .post(`/conversations/${conversationId}/reopen`)
        .set(as(owner))
        .expect(201);
      const changes = (await events()).filter(
        (e) => e.type === 'STATUS_CHANGED',
      );
      expect(
        changes.map((e) => [e.data.from, e.data.to, e.actor?.name]),
      ).toEqual([
        ['OPEN', 'RESOLVED', 'agent'],
        ['RESOLVED', 'OPEN', 'owner'],
      ]);
    });

    it('changes priority (validated) and logs it', async () => {
      const res = await api()
        .patch(`/conversations/${conversationId}`)
        .set(as(agent))
        .send({ priority: 'URGENT' })
        .expect(200);
      expect(res.body.priority).toBe('URGENT');
      await api()
        .patch(`/conversations/${conversationId}`)
        .set(as(agent))
        .send({ priority: 'URGENT' })
        .expect(200);
      await api()
        .patch(`/conversations/${conversationId}`)
        .set(as(agent))
        .send({ priority: 'SOON' })
        .expect(400);
      const changes = (await events()).filter(
        (e) => e.type === 'PRIORITY_CHANGED',
      );
      expect(changes).toHaveLength(1);
      expect(changes[0].data).toMatchObject({ from: 'NORMAL', to: 'URGENT' });
    });

    it('logs tag changes by name, once', async () => {
      const tag = await api()
        .post('/tags')
        .set(as(owner))
        .send({ name: 'VIP', color: '#6366F1' })
        .expect(201);
      await api()
        .post(`/conversations/${conversationId}/tags/${tag.body.id}`)
        .set(as(agent))
        .expect(201);
      await api()
        .post(`/conversations/${conversationId}/tags/${tag.body.id}`)
        .set(as(agent))
        .expect(201);
      await api()
        .post(`/conversations/${conversationId}/tags/${tag.body.id}/remove`)
        .set(as(agent))
        .expect(201);
      await api()
        .post(`/conversations/${conversationId}/tags/${tag.body.id}/remove`)
        .set(as(agent))
        .expect(201);
      const tagEvents = (await events()).filter((e) =>
        e.type.startsWith('TAG_'),
      );
      expect(tagEvents.map((e) => [e.type, e.data.tagName])).toEqual([
        ['TAG_ADDED', 'VIP'],
        ['TAG_REMOVED', 'VIP'],
      ]);
    });

    it('keeps internal notes in the timeline, validated and private to the workspace', async () => {
      await api()
        .post(`/conversations/${conversationId}/notes`)
        .set(as(agent))
        .send({ text: '  Called them, will follow up Monday  ' })
        .expect(201);
      await api()
        .post(`/conversations/${conversationId}/notes`)
        .set(as(agent))
        .send({ text: '' })
        .expect(400);
      await api()
        .post(`/conversations/${conversationId}/notes`)
        .set(as(outsider, otherWs))
        .send({ text: 'x' })
        .expect(404);
      await api()
        .get(`/conversations/${conversationId}/events`)
        .set(as(outsider, otherWs))
        .expect(404);

      const list = await events(agent);
      const note = list.filter((e) => e.type === 'NOTE');
      expect(note).toMatchObject([
        {
          data: { text: 'Called them, will follow up Monday' },
          actor: { name: 'agent' },
        },
      ]);
      // Notes are not messages: nothing is queued for the customer.
      const sent = await db
        .getRepository(Message)
        .count({ where: { conversationId } });
      expect(sent).toBe(0);
    });
  });

  describe('automation rules', () => {
    let tagId: string;
    let agentMemberId: string;
    let ruleId: string;

    beforeAll(async () => {
      tagId = (
        await api()
          .post('/tags')
          .set(as(owner))
          .send({ name: 'Refund', color: '#EF4444' })
          .expect(201)
      ).body.id;
      const members = await api()
        .get('/workspace/members')
        .set(as(owner))
        .expect(200);
      agentMemberId = members.body.find(
        (m: { role: string }) => m.role === 'AGENT',
      ).id;
    });

    const rule = (over: Record<string, unknown> = {}) => ({
      name: 'Refund requests',
      conditions: [{ type: 'KEYWORDS', keywords: ['refund', 'chargeback'] }],
      actions: [
        { type: 'ADD_TAG', tagId },
        { type: 'SET_PRIORITY', priority: 'HIGH' },
        { type: 'ASSIGN', memberIds: [agentMemberId] },
      ],
      ...over,
    });

    it('is for admins only', async () => {
      await api().get('/automation-rules').set(as(agent)).expect(403);
      await api()
        .post('/automation-rules')
        .set(as(agent))
        .send(rule())
        .expect(403);
    });

    it('creates, lists, updates (toggle, edit) and deletes a rule', async () => {
      const created = await api()
        .post('/automation-rules')
        .set(as(owner))
        .send(rule())
        .expect(201);
      ruleId = created.body.id;
      expect(created.body).toMatchObject({
        enabled: true,
        position: 0,
        triggerCount: 0,
      });

      const list = await api()
        .get('/automation-rules')
        .set(as(owner))
        .expect(200);
      expect(list.body.map((r: { name: string }) => r.name)).toEqual([
        'Refund requests',
      ]);

      const off = await api()
        .patch(`/automation-rules/${ruleId}`)
        .set(as(owner))
        .send({ enabled: false })
        .expect(200);
      expect(off.body.enabled).toBe(false);
      const renamed = await api()
        .patch(`/automation-rules/${ruleId}`)
        .set(as(owner))
        .send({ name: 'Refunds', conditions: [{ type: 'FIRST_MESSAGE' }] })
        .expect(200);
      expect(renamed.body).toMatchObject({
        name: 'Refunds',
        conditions: [{ type: 'FIRST_MESSAGE' }],
      });

      await api()
        .delete(`/automation-rules/${ruleId}`)
        .set(as(owner))
        .expect(204);
      expect(
        (await api().get('/automation-rules').set(as(owner))).body,
      ).toEqual([]);
    });

    it('rejects bad rules with readable messages', async () => {
      const post = (body: object) =>
        api().post('/automation-rules').set(as(owner)).send(body);
      expect(
        (await post(rule({ actions: [] })).expect(400)).body.message,
      ).toContain('at least one action');
      expect(
        (
          await post(
            rule({ conditions: [{ type: 'KEYWORDS', keywords: [] }] }),
          ).expect(400)
        ).body.message,
      ).toContain('keyword');
      expect(
        (
          await post(
            rule({
              actions: [
                {
                  type: 'ADD_TAG',
                  tagId: '00000000-0000-4000-8000-000000000000',
                },
              ],
            }),
          ).expect(400)
        ).body.message,
      ).toContain('tag from this workspace');
      expect(
        (
          await post(
            rule({ actions: [{ type: 'AUTO_REPLY', text: '' }] }),
          ).expect(400)
        ).body.message,
      ).toContain('some text');
      await post(rule({ name: '' })).expect(400);
      await post({ ...rule(), surprise: true }).expect(400);
    });

    it("does not let a rule point at another workspace's teammates or tags", async () => {
      const others = await api()
        .get('/workspace/members')
        .set(as(outsider, otherWs))
        .expect(200);
      const foreignMember = others.body[0].id;
      const res = await api()
        .post('/automation-rules')
        .set(as(owner))
        .send(
          rule({ actions: [{ type: 'ASSIGN', memberIds: [foreignMember] }] }),
        )
        .expect(400);
      expect(res.body.message).toContain('this workspace');
    });

    it('keeps rules private to their workspace', async () => {
      const created = await api()
        .post('/automation-rules')
        .set(as(owner))
        .send(rule())
        .expect(201);
      expect(
        (
          await api()
            .get('/automation-rules')
            .set(as(outsider, otherWs))
            .expect(200)
        ).body,
      ).toEqual([]);
      await api()
        .patch(`/automation-rules/${created.body.id}`)
        .set(as(outsider, otherWs))
        .send({ enabled: false })
        .expect(404);
      await api()
        .delete(`/automation-rules/${created.body.id}`)
        .set(as(outsider, otherWs))
        .expect(404);
    });
  });
});
