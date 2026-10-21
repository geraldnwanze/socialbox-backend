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

    it('only lets agents of the same workspace signal typing', async () => {
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
      await api()
        .post(`/conversations/${conversation.id}/typing`)
        .set(as(agent))
        .expect(204);
      await api()
        .post(`/conversations/${conversation.id}/typing`)
        .set(as(outsider, otherWs))
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
});
