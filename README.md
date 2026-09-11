# SocialBox — Unified Social Inbox (Backend)

All your social messages. One inbox. This is the NestJS API + worker for a unified social/messaging
inbox SaaS: businesses connect channels (WhatsApp, Telegram, Facebook Messenger, Instagram — see
[docs/social-platform-capabilities.md](docs/social-platform-capabilities.md) for what's actually
functional and why), receive customer messages in one place, and reply from a shared team inbox.

The companion Next.js frontend lives in a sibling repository (`socialbox-frontend`).

## Architecture

A modular monolith — no microservices, no Kafka/Elasticsearch/Kubernetes for this MVP.

```
NestJS API  ──┬── PostgreSQL   (source of truth)
              ├── Redis        (BullMQ + refresh-token blocklist)
              ├── BullMQ Workers (separate process — see src/worker.ts)
              └── Socket.IO     (realtime events to connected agents)
```

Every social platform is isolated behind a `ChannelAdapter` (`src/channels/interfaces/channel-adapter.interface.ts`).
The rest of the app — conversations, messages, contacts — only ever talks to that interface via
`ChannelAdapterRegistry`, never to a provider SDK directly. Adding a new channel means writing one
adapter class; the core messaging domain never changes.

```
ConversationsService / MessagesService
              │
              ▼
     ChannelAdapterRegistry
              │
   ┌────┬─────┼─────┬────────┐
   ▼    ▼     ▼      ▼        ▼
WhatsApp Telegram Messenger Instagram  X (stub)
```

Inbound flow: Webhook Controller → verify signature → idempotency insert (`webhook_events`) →
BullMQ `webhooks` queue → `WebhookProcessor` normalizes via the adapter → find/create contact →
find/create conversation → persist message (idempotent) → emit Socket.IO event.

Outbound flow: `POST /conversations/:id/messages` → message row `QUEUED` → BullMQ
`outbound-messages` queue → `OutboundMessageProcessor` → adapter `sendMessage()` → `SENT`/`FAILED`
→ Socket.IO event.

## Requirements

- Node.js 22+
- Docker (for Postgres + Redis — **do not** install these directly on your machine; everything is
  wired to talk to the Dockerized services)

## Local setup

```bash
npm install
cp .env.example .env
```

Generate real secrets for `.env` (the placeholders in `.env.example` are not usable as-is):

```bash
node -e "console.log('JWT_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('JWT_REFRESH_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('CREDENTIALS_ENCRYPTION_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
```

Start Postgres + Redis:

```bash
docker compose -f docker-compose.dev.yml up -d
```

Run migrations and seed demo data:

```bash
npm run migration:run
npm run seed
```

This creates a demo workspace with two logins (both password `password123`):

- `owner@demo.socialbox.local` — OWNER
- `agent@demo.socialbox.local` — AGENT

Run the API and worker (two terminals — they are separate processes, matching the
architecture diagram above):

```bash
npm run start:dev     # API on http://localhost:3001
npm run worker:dev    # BullMQ worker (webhooks, outbound-messages, media, notifications)
```

## Environment variables

See [.env.example](.env.example) for the full list. Only the channel-specific variables for
channels you actually connect are required — the app runs fine with none of them set (channels
just can't be connected until their credentials exist).

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `REDIS_URL` | Redis connection string (BullMQ + refresh-token blocklist) |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Auth token signing (use different, long random values) |
| `CREDENTIALS_ENCRYPTION_KEY` | 32-byte base64 key encrypting channel OAuth tokens at rest |
| `R2_*` | Cloudflare R2 (S3-compatible) for media storage |
| `WHATSAPP_*` | WhatsApp Cloud API app secret / verify token |
| `TELEGRAM_*` | Telegram webhook secret (bot tokens are supplied per-connection at connect time, not env vars) |
| `META_*` | Shared Meta app secret/verify token for Messenger + Instagram |
| `SENTRY_DSN` | Error tracking (optional) |

## Database

TypeORM migrations only — `synchronize` is hard-disabled in `DatabaseModule`, in dev and prod alike.

```bash
npm run migration:generate -- src/database/migrations/SomeChange   # after editing entities
npm run migration:run
npm run migration:revert
```

## Running tests

Tests need the Dockerized Postgres/Redis running (`docker compose -f docker-compose.dev.yml up -d`)
— several integration/e2e tests exercise real Postgres features (`jsonb`, enums, `ON CONFLICT`).

```bash
npm run test        # unit tests
npm run test:e2e    # e2e + integration tests, including the webhook-idempotency suite
npm run test:cov
npm run lint
```

`test/webhook-idempotency.e2e-spec.ts` is the test that matters most architecturally: it proves
that delivering the same inbound message three times results in exactly one row in `messages`,
and that the same webhook event key only ever enqueues one processing job.

## Docker (full stack)

```bash
docker compose up --build
```

Runs Postgres, Redis, the API, and the worker as four containers (`docker-compose.yml`). Run
migrations against the containerized Postgres separately (`DATABASE_URL` pointed at it) before
first use.

## Webhook setup (per channel)

All webhook endpoints require a **public HTTPS URL** — use a tunnel (e.g. `ngrok http 3001`) for
local development.

- **Telegram**: no dashboard config needed. Connecting a bot via `POST /channels/TELEGRAM/connect`
  automatically calls Telegram's `setWebhook` with a connection-specific URL
  (`{API_URL}/webhooks/telegram/{connectionId}`).
- **WhatsApp**: in Meta App Dashboard → WhatsApp → Configuration, set the callback URL to
  `{API_URL}/webhooks/whatsapp` and the verify token to `WHATSAPP_VERIFY_TOKEN`.
- **Messenger / Instagram**: in Meta App Dashboard → Webhooks, set the callback URL to
  `{API_URL}/webhooks/meta` (shared endpoint, dispatched by payload `object` field) and the verify
  token to `META_VERIFY_TOKEN`. Subscribe to the `messages`, `message_deliveries` fields.

## OAuth / third-party developer setup

This MVP uses direct credential entry (`POST /channels/:type/connect` with provider credentials
in the body) rather than a full OAuth redirect flow, since embedded-signup OAuth needs a
publicly reachable, review-approved app for most providers. What you need per channel:

- **Telegram**: create a bot with [@BotFather](https://t.me/BotFather), no review needed.
- **WhatsApp Cloud API**: a Meta Business Manager account, a WhatsApp Business app, and either a
  free developer test number (works immediately, 5 recipient limit) or a verified business number.
- **Facebook Messenger**: a Meta App with the Messenger product added and a Page you administer
  (works immediately for that Page; other businesses' Pages need App Review).
- **Instagram**: same Meta App with Instagram Messaging added, an Instagram professional account
  linked to a Page (works for up to 25 test users without App Review).

Full detail, including exactly what's blocked and why, is in
[docs/social-platform-capabilities.md](docs/social-platform-capabilities.md).

## Production deployment

1. Build and push the image: `docker build -t socialbox-api .`
2. Run `node dist/main.js` for the API and `node dist/worker.js` for the worker from the **same**
   image (see `Dockerfile` — the `CMD` is overridden for the worker service).
3. Run `npm run migration:run` against the production database as a release step, before starting
   new containers.
4. Terminate TLS and reverse-proxy through Nginx/Cloudflare in front of the API container; the app
   itself is plain HTTP.
5. Set `NODE_ENV=production` and every secret in the environment table above via your platform's
   secret manager — never bake them into the image.
6. Point `WHATSAPP_*`/`META_*` verify tokens and webhook URLs at the production domain in each
   platform's developer dashboard.

## Known limitations

- **X and TikTok are not functional** — see docs/social-platform-capabilities.md. Their adapters
  either throw a clear "not implemented" error (X) or don't exist (TikTok).
- **WhatsApp/Messenger/Instagram production use** needs Meta Business Verification and/or App
  Review, both offline processes outside this codebase — everything works today against
  test numbers/test users/your own Page.
- **No OAuth redirect flow** for Meta channels yet — credentials are entered directly. Swapping
  in Facebook Login for Business is additive (a new `connect()` implementation per adapter), not
  a rearchitecture.
- **No outbound email** — password reset generates a token and logs it (dev-only) rather than
  emailing it, since no transactional email provider is configured. Wiring one in is a single
  new call inside `AuthService.requestPasswordReset`.
- **Refresh tokens** are stateless JWTs with a Redis-backed single-use blocklist (rotated on every
  refresh) rather than a full session table — sufficient for MVP revocation needs.

## Recommended next steps

- Wire a transactional email provider for password reset + team invites.
- Add Facebook Login for Business (OAuth) as an alternative to direct Messenger/Instagram token entry.
- Move WhatsApp/Messenger/Instagram through Meta App Review once ready to onboard real businesses.
- Add a dedicated search index if/when Postgres `ILIKE` search stops being fast enough (the
  repository layer is already isolated behind service methods, so this doesn't touch controllers).
- Implement saved replies, analytics, and the other features explicitly deferred in this MVP's scope.
