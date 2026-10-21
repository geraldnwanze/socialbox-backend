# SocialBox — Unified Social Inbox (Backend)

All your social messages. One inbox. This is the NestJS API + worker for a unified social/messaging
inbox SaaS: businesses connect channels (WhatsApp, Telegram, Facebook Messenger, Instagram, email over IMAP/SMTP, and a built-in website live chat widget — see
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
| `R2_*` | Cloudflare R2 (S3-compatible) for media storage. `R2_PUBLIC_ENDPOINT` is only needed when the server reaches storage at an internal address that browsers can't (it's used to sign links for browsers) |
| `EMAIL_IDLE_ENABLED` | Keep IMAP IDLE connections for instant email (default `true`) |
| `WHATSAPP_*` | WhatsApp Cloud API app secret / verify token |
| `TELEGRAM_*` | Telegram webhook secret (bot tokens are supplied per-connection at connect time, not env vars) |
| `META_*` | Shared Meta app secret/verify token for Messenger + Instagram |
| `EMAIL_ALLOW_PRIVATE_HOSTS` | Dev/test only (default `false`): allow mailboxes on private networks and unencrypted IMAP/SMTP |
| `EMAIL_POLL_INTERVAL_MS` | How often mailboxes are checked for new mail (default 30000) |
| `SENTRY_DSN` | Error tracking (optional) |

## Database

TypeORM migrations only — `synchronize` is hard-disabled in `DatabaseModule`, in dev and prod alike.

```bash
npm run migration:generate -- src/database/migrations/SomeChange   # after editing entities
npm run migration:run
npm run migration:revert
```

## Running tests

The e2e tests exercise real Postgres features (`jsonb`, enums, `ON CONFLICT`), so they need a
database. The easiest way, and the one that works while the full stack is running (its database port
isn't published to the host), is the self-contained Docker run: it starts a **disposable** Postgres +
Redis, runs the suite inside the network, and never touches your dev data.

```bash
npm run test:e2e:docker    # builds, runs everything in Docker, then cleans up
```

To run against the dev infrastructure instead (`docker compose -f docker-compose.dev.yml up -d`,
which publishes the ports), use `npm run test:e2e` directly.

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

## Live chat widget

A website chat widget is a built-in channel (`LIVE_CHAT`) — no third-party account or review needed.

1. In the dashboard: **Settings → Channels → Live chat → Connect**. Optionally set the title,
   greeting, brand color and the websites allowed to use it.
2. Copy the snippet shown on the card and paste it before `</body>` on your site:
   ```html
   <script src="https://YOUR-API/widget.js" data-key="wk_..." async></script>
   ```
3. Visitors' messages arrive in the shared inbox like any other channel; replies go back to the widget.

How it works: the script (`src/widget/widget-script.ts`, dependency-free, Shadow DOM) talks to public
endpoints under `/widget/*`. A visitor gets a signed token (stored in their browser's localStorage) and
messages go through the same idempotent webhook → queue → worker pipeline as every other channel. The
widget **polls** every 3s while open (15s while closed) rather than holding a socket.

Things to know:
- **Allowed websites** is a soft control: browsers always send an honest `Origin` header, so it stops
  your key being reused on other people's sites, but a non-browser client can send anything. The widget
  key itself is public by design.
- **Pre-chat form**: in the channel's settings you can ask visitors for their name and/or email before
  they chat. They become the contact's name and email (visitors without them are "Website visitor ABCD").
  A name an agent edited by hand is never overwritten. There is no "identify" API for logged-in users yet.
- **Opening hours**: optionally set days, hours and a time zone. Outside them the widget shows your offline
  note; visitors can still leave messages. With no hours configured the widget is always "online".
- **Typing indicators** both ways: agents see "…is typing" while the visitor types, and the visitor sees
  "Typing…" while an agent types.
- **Files**: visitors can attach images, PDF, text and Office files up to 5 MB (not SVG/HTML/archives —
  the type *and* extension must both be on the allow-list); agents can send files back. Needs object
  storage (`R2_*`). Uploads are rate limited (10/min per IP).
- **Visitor details**: agents see the visitor's IP address, country (flag + name) and the page they
  were on, in the customer panel. IP and country come from the server's view of the request, never
  from the page: `TRUST_PROXY_HOPS` must match how many proxies sit in front of the API (wrong value =
  you'd record your proxy's IP). Country is resolved offline with a bundled GeoIP database
  (DB-IP "lite" country data via the `@ip-location-db/dbip-country-mmdb` package, ~8 MB, country-level; it's
  refreshed by updating that package — licensed CC BY 4.0, hence the "IP geolocation by DB-IP" credit in the panel), so no
  visitor IPs are sent to third parties; private/localhost addresses have no country. If you use
  Cloudflare, set `TRUST_CLOUDFLARE_HEADERS=true` to use its `CF-Connecting-IP`/`CF-IPCountry`
  instead — only when the API is not reachable except through Cloudflare. The page URL is supplied by
  the visitor's browser (display only, sanitized to plain http(s)). IP addresses are personal data
  under GDPR-style laws: mention them in your privacy policy and decide how long to keep them.
- Disconnecting disables the widget immediately; reconnecting keeps the **same key**, so embedded
  snippets don't need updating.
- Public endpoints are rate limited per IP (20 sessions/min, 30 sends/min, 60 polls/min). The widget still
  polls (3s open, 15s closed) rather than holding a socket, so replies can take a few seconds to show.

## Email channel

Email works over plain **IMAP (receive) + SMTP (send)**, so any mailbox works — Gmail/Google
Workspace (with an app password), Outlook, or your own domain — with no vendor account or DNS changes.

1. **Settings → Channels → Email → Connect**: address, username/password, and the IMAP/SMTP servers.
   Both are tested on connect, so wrong details fail with a clear message instead of silently.
2. New mail appears in the inbox within a couple of seconds; replies are sent via SMTP.

How it works: the **worker** keeps an **IMAP IDLE** connection open per mailbox, so new mail is
imported within a second or two (reconnecting with backoff, and picking up anything that arrived while
it was down). A slower repeating poll (queue `email-sync`, `EMAIL_POLL_INTERVAL_MS`, default 60s) is the
safety net. Both run the same import, driven by a per-mailbox cursor (IMAP UIDVALIDITY + last UID) stored in the connection metadata. Each
mail is handed to the same idempotent webhook → queue pipeline as every other channel, keyed on its
`Message-ID`, so crashes or re-polls never create duplicates or lose mail.

- **One conversation per sender address.** Replies are threaded for the customer's mail client
  (`In-Reply-To`/`References` and `Re: <their subject>`). The subject of each received mail is shown
  above its text.
- **Only new mail** is imported — existing mailbox history is not. Reconnecting the same mailbox
  resumes where it left off.
- **Skipped on purpose:** auto-replies, bulk/list mail, delivery-failure bounces, and mail from the
  mailbox itself (these clutter the inbox and can start mail loops). Quoted history ("On … wrote:", `>`
  lines) is trimmed from the displayed text.
- **Attachments** work both ways (up to 10 MB each, 25 MB / 10 files per mail; inline signature images
  are skipped, and a file that can't be saved is noted in the message instead of blocking the mail).
  They need object storage (`R2_*`, see below). Downloads use short-lived signed links and are forced
  as downloads, never rendered from the storage domain.
- **Formatted view:** HTML mail is sanitized on arrival (basic formatting only: no scripts, styles,
  forms or remote images — those would tell the sender when you opened the mail; quoted history is
  removed) and shown on request in a sandboxed frame, next to the always-available plain text.
- **Not supported yet:** mail in folders other than INBOX, inline images, and a copy of sent replies in
  the mailbox's Sent folder (many SMTP servers, e.g. Gmail, do that themselves).
- **Security:** credentials are encrypted at rest and never returned by the API. Mail server hosts are
  resolved and **refused if they point at private/internal addresses** (so an admin can't aim the
  server at its own network), and unencrypted transport is rejected, unless
  `EMAIL_ALLOW_PRIVATE_HOSTS=true` — a development setting. If the mailbox later rejects the login
  (password changed), the channel is marked `ERROR` with the reason and polling stops until you update
  the credentials via **Settings**.
- **Try it locally** without a real mailbox: `docker compose -f docker-compose.yml -f docker-compose.mailtest.yml -f docker-compose.storage-test.yml up -d --build`
  starts a throwaway mail server (GreenMail). Connect `support@example.com` / user `support` / password
  `secret`, IMAP `greenmail:3143`, SMTP `greenmail:3025`, security *None*. `docker-compose.storage-test.yml`
  adds a local S3-compatible store so attachments work without a Cloudflare R2 account. Don't use these overlays in production.

## Read receipts and delivery status

When an agent opens a conversation, the customer's messages are marked read (once), and the channel is
told in the background (queue `read-receipts`, worker):

| Channel | Agent reads → | Delivery status of your replies |
|---|---|---|
| WhatsApp / Messenger / Instagram | "seen" sent to the customer | sent → delivered → read, from the provider's webhooks |
| Live chat | the visitor sees "Seen" under their message | delivered when the widget fetches the reply, read when the chat is open and in view |
| Email | the mail gets the IMAP `\Seen` flag in the shared mailbox (nothing is sent to the customer) | a bounce ("delivery failed" report) marks the reply **failed** with the server's reason; there is no "delivered" signal in email |
| Telegram | not possible (the Bot API has no read receipts) | sent only |

**Settings → Workspace → Read receipts** (admins) switches off everything the *customer* can see (WhatsApp/
Messenger "seen", live chat "Seen"). Marking mail read in your own mailbox is unaffected. The setting is
checked when the job runs, so turning it off also stops receipts that were already queued.

## Saved replies, contacts and analytics

- **Saved replies** (Settings → Saved replies): admins manage reusable answers (`/shortcut`, title,
  text). Agents type `/` in the composer (or use the button) to search and insert one. `{{customer_name}}`
  becomes the customer's first name ("there" when unknown) and `{{agent_name}}` the agent's first name.
- **Contacts**: each contact has a detail page with editable name/email/phone and internal notes, every
  channel identity, and all their conversations. Admins can **merge** a duplicate into a contact (moves
  identities and conversations, fills blanks, then deletes the duplicate). Merging is always manual —
  contacts are never auto-matched across channels.
- **Analytics** (admins/owners): conversations started per day, first-response time (median/average/p90),
  resolution time, and breakdowns by channel and agent for 7/30/90 days. Times are wall-clock (no
  business hours), days are UTC, and only a human agent's first reply counts. Resolution time relies on
  `conversations.resolved_at`; conversations resolved before it existed use their last-updated time.

## Known limitations

- **X and TikTok are not functional** — see docs/social-platform-capabilities.md. Their adapters
  either throw a clear "not implemented" error (X) or don't exist (TikTok).
- **WhatsApp/Messenger/Instagram production use** needs Meta Business Verification and/or App
  Review, both offline processes outside this codebase — everything works today against
  test numbers/test users/your own Page.
- **No OAuth redirect flow** for Meta channels yet — credentials are entered directly. Swapping
  in Facebook Login for Business is additive (a new `connect()` implementation per adapter), not
  a rearchitecture.
- **No transactional email** — password reset generates a token and logs it (dev-only) rather than
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
- Email: inline images, other folders, per-thread conversations.
- Live chat: realtime delivery to the widget (it polls), an identify API for logged-in users.
- Business-hours-aware response-time stats and per-agent personal saved replies.
