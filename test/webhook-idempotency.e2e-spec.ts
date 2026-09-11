import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { WorkspacesService } from '../src/workspaces/workspaces.service';
import { AuthService } from '../src/auth/auth.service';
import { ContactsService } from '../src/contacts/contacts.service';
import { ConversationsService } from '../src/conversations/conversations.service';
import { MessagesService } from '../src/messages/messages.service';
import { WebhooksService } from '../src/webhooks/webhooks.service';
import { ChannelConnection } from '../src/channels/entities/channel-connection.entity';
import { Message } from '../src/messages/entities/message.entity';
import { WebhookEvent } from '../src/webhooks/entities/webhook-event.entity';
import {
  ChannelConnectionStatus,
  ChannelType,
} from '../src/channels/enums/channel-type.enum';
import { MessageType, SenderType } from '../src/messages/enums/message.enums';

/**
 * Covers the mandatory scenario from the spec: "the same webhook arrives five times -> the
 * system still creates one message, not five." Exercises the two layers that jointly guarantee
 * this — the webhook_events idempotency ledger and the messages table's own unique constraint —
 * directly through the services, since no worker process is running in this test to drain the
 * BullMQ queue the HTTP webhook endpoints enqueue onto.
 */
describe('Webhook idempotency (e2e)', () => {
  let app: INestApplication;
  let workspacesService: WorkspacesService;
  let authService: AuthService;
  let contactsService: ContactsService;
  let conversationsService: ConversationsService;
  let messagesService: MessagesService;
  let webhooksService: WebhooksService;
  let channelConnections: Repository<ChannelConnection>;
  let messages: Repository<Message>;
  let webhookEvents: Repository<WebhookEvent>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    workspacesService = moduleFixture.get(WorkspacesService);
    authService = moduleFixture.get(AuthService);
    contactsService = moduleFixture.get(ContactsService);
    conversationsService = moduleFixture.get(ConversationsService);
    messagesService = moduleFixture.get(MessagesService);
    webhooksService = moduleFixture.get(WebhooksService);
    channelConnections = moduleFixture.get(
      getRepositoryToken(ChannelConnection),
    );
    messages = moduleFixture.get(getRepositoryToken(Message));
    webhookEvents = moduleFixture.get(getRepositoryToken(WebhookEvent));
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates exactly one message when the same inbound event is processed twice', async () => {
    const { user } = await authService.register({
      email: `idempotency-${Date.now()}@example.com`,
      password: 'password123',
      fullName: 'Idempotency Test',
    });
    const workspace = await workspacesService.create(
      user.id,
      'Idempotency Workspace',
    );

    const connection = await channelConnections.save(
      channelConnections.create({
        workspaceId: workspace.id,
        type: ChannelType.TELEGRAM,
        provider: 'TelegramAdapter',
        status: ChannelConnectionStatus.CONNECTED,
        externalAccountId: `bot-${Date.now()}`,
      }),
    );

    const { contact, identity } =
      await contactsService.findOrCreateFromIdentity({
        workspaceId: workspace.id,
        channelConnectionId: connection.id,
        channel: ChannelType.TELEGRAM,
        externalUserId: '555000111',
        displayName: 'Test Customer',
      });

    const { conversation } = await conversationsService.findOrCreateForInbound({
      workspaceId: workspace.id,
      channelConnectionId: connection.id,
      externalConversationId: '555000111',
      contactId: contact.id,
      contactIdentityId: identity.id,
      firstMessageAt: new Date(),
    });

    const externalMessageId = `telegram-msg-${Date.now()}`;
    const inboundInput = {
      workspaceId: workspace.id,
      conversationId: conversation.id,
      channelConnectionId: connection.id,
      externalMessageId,
      senderExternalId: '555000111',
      messageType: MessageType.TEXT,
      content: 'How much is this?',
      attachments: [],
      sentAt: new Date(),
    };

    const first = await messagesService.createInbound(inboundInput);
    const second = await messagesService.createInbound(inboundInput);
    const third = await messagesService.createInbound(inboundInput);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.created).toBe(false);
    expect(second.message.id).toBe(first.message.id);

    const stored = await messages.find({
      where: { channelConnectionId: connection.id, externalMessageId },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0].senderType).toBe(SenderType.CONTACT);

    const updatedConversation = await conversationsService.findOneForWorkspace(
      workspace.id,
      conversation.id,
    );
    // Only the first (successful) insert should have incremented the unread counter.
    expect(updatedConversation.unreadCount).toBe(1);
  });

  it('enqueues a webhook-processing job only once for a repeated delivery', async () => {
    const { user } = await authService.register({
      email: `idempotency-webhook-${Date.now()}@example.com`,
      password: 'password123',
      fullName: 'Webhook Idempotency Test',
    });
    const workspace = await workspacesService.create(
      user.id,
      'Webhook Idempotency Workspace',
    );

    const connection = await channelConnections.save(
      channelConnections.create({
        workspaceId: workspace.id,
        type: ChannelType.TELEGRAM,
        provider: 'TelegramAdapter',
        status: ChannelConnectionStatus.CONNECTED,
        externalAccountId: `bot-webhook-${Date.now()}`,
      }),
    );

    const eventKey = `telegram:${Date.now()}`;
    const payload = { update_id: Date.now(), message: { text: 'hi' } };

    await webhooksService.ingest('telegram', connection.id, payload, [
      eventKey,
    ]);
    await webhooksService.ingest('telegram', connection.id, payload, [
      eventKey,
    ]);
    await webhooksService.ingest('telegram', connection.id, payload, [
      eventKey,
    ]);

    const rows = await webhookEvents.find({
      where: { provider: 'telegram', externalEventId: eventKey },
    });
    expect(rows).toHaveLength(1);
  });
});
