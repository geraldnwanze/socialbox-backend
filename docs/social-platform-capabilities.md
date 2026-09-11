# Social Platform Capabilities

Researched September 2026. This document records what each platform's **official** API can
actually do for a third-party inbox SaaS, and drives which channels are implemented in the MVP.
No scraping, unofficial APIs, or browser automation are used for any channel — only documented,
supported endpoints.

Legend for **Status**: `Implemented` (real adapter, works end-to-end today) · `Implemented (dev/test mode)`
(real adapter, functionally complete, but production use for third-party pages/accounts needs Meta App
Review + Business Verification which cannot be completed inside this codebase) · `Pending` (adapter
interface exists as a stub, not wired to a real provider) · `Unsupported` (no general-purpose official
API exists; not built).

---

## WhatsApp (WhatsApp Cloud API)

**Status: Implemented**

| Capability | Supported? | Notes |
|---|---|---|
| Authenticate a business account | Yes | Embedded Signup / manual System User token via Meta Business Manager |
| Receive messages | Yes | Webhooks (`messages` field) |
| Send messages | Yes | Cloud API `/messages` endpoint |
| Webhooks | Yes | HTTPS callback, `hub.verify_token` handshake + `X-Hub-Signature-256` HMAC verification |
| Identify conversations | Yes | `wa_id` (phone number) is stable per contact |
| Identify users | Yes | Phone number + profile name from webhook payload |
| Retrieve media | Yes | Media ID → signed download URL, expires quickly, must be fetched promptly |
| Mark as read | Yes | `POST /messages` with `status: read` |
| Delivery/read status | Yes | `sent` / `delivered` / `read` / `failed` status webhooks |
| Send attachments | Yes | Image, video, audio, document, sticker (by media ID or link) |

**Required permissions/setup**: Meta Business Manager account, a WhatsApp Business app, a
phone number registered to the Cloud API (a free Meta test number works for development —
limited to 5 recipient numbers you manually add), a permanent System User access token,
`whatsapp_business_messaging` + `whatsapp_business_management` permissions.

**App review / business verification**: A developer test number needs **no review** and is
enough to fully exercise this MVP's adapter. Sending from a real production business number to
arbitrary customers requires **Meta Business Verification** — this is an offline, account-level
process (business documents) that cannot be completed from inside this codebase.

**Restrictions**: Free-form text replies are only allowed within a **24-hour customer service
window** after the customer's last message. Outside that window, only pre-approved **message
templates** can be sent. The adapter surfaces `FAILED` with the provider error when a free-form
send is attempted outside the window rather than pretending it succeeded.

**Rate limits**: Tiered by business phone number quality rating (starts at 250 unique
conversations/24h, scales up). Pricing is per-conversation (category-based).

---

## Telegram (Telegram Bot API)

**Status: Implemented**

| Capability | Supported? | Notes |
|---|---|---|
| Authenticate | Yes | Create a bot via @BotFather, get a bot token — no app review, no business verification |
| Receive messages | Yes | Webhook (`setWebhook`) or long polling |
| Send messages | Yes | `sendMessage` / `sendPhoto` / `sendDocument` / etc. |
| Webhooks | Yes | HTTPS callback; verified via a secret token header (`X-Telegram-Bot-Api-Secret-Token`) |
| Identify conversations | Yes | `chat.id` |
| Identify users | Yes | `from.id`, username, display name |
| Retrieve media | Yes | `getFile` → temporary download URL |
| Mark as read | No | Bot API has no "mark as read" concept for the business side |
| Delivery/read status | No | Telegram does not expose delivery/read receipts to bots |
| Send attachments | Yes | Photo, video, audio, document, sticker |

**Required permissions/setup**: None beyond creating a bot with @BotFather. No app review, no
business verification, no waiting period — this is why it is the first channel wired end-to-end
and used as the reference implementation for the adapter pattern.

**Restrictions**: A Telegram "contact" is only reachable after they message the bot first
(bots cannot cold-message arbitrary users). This matches the inbound-first nature of the MVP.

**Rate limits**: ~30 messages/second broadcast-wide, 1 message/second per chat (soft limits,
enforced by Telegram with 429s + `retry_after`).

---

## Facebook Messenger (Messenger Platform)

**Status: Implemented (dev/test mode)**

| Capability | Supported? | Notes |
|---|---|---|
| Authenticate | Yes | Facebook Login for Business → Page Access Token |
| Receive messages | Yes | Webhooks (`messages` field on a Page subscription) |
| Send messages | Yes | Send API (`/me/messages`) |
| Webhooks | Yes | HTTPS callback, `hub.verify_token` handshake + `X-Hub-Signature-256` HMAC |
| Identify conversations | Yes | Page-Scoped ID (PSID) |
| Identify users | Yes | PSID; profile fields require `pages_messaging` + user consent |
| Retrieve media | Yes | Attachment URL provided directly in the webhook payload |
| Mark as read | Yes | `sender_action: mark_seen` |
| Delivery/read status | Yes | `message_deliveries` / `message_reads` webhook events |
| Send attachments | Yes | Image, video, audio, file |

**Required permissions/setup**: A Facebook App with the Messenger product added, a connected
Page, `pages_messaging` + `pages_manage_metadata` permissions.

**App review / business verification**: Sending/receiving on a Page you personally administer
(added as a developer/tester on the app) works today with **no review** — this is how the
adapter is exercised in development. Onboarding **other businesses' Pages** (i.e. running this
as a real multi-tenant SaaS) requires Meta **App Review** for `pages_messaging` (Advanced
Access) plus **Business Verification**, both offline/manual processes outside this codebase.

**Restrictions**: The standard messaging window is 24 hours from the customer's last message;
outside it, only tagged message types for specific use cases are allowed.

---

## Instagram (Instagram Messaging API)

**Status: Implemented (dev/test mode)**

Uses the same underlying Meta Graph API + webhook infrastructure as Messenger, via the shared
Meta adapter base class.

| Capability | Supported? | Notes |
|---|---|---|
| Authenticate | Yes | Instagram professional account linked to a Facebook Page, via Facebook Login for Business |
| Receive messages | Yes | Webhooks (`messages` field on the `instagram` subscription) |
| Send messages | Yes | `/me/messages` on the Instagram-scoped endpoint |
| Webhooks | Yes | Same HMAC-verified callback mechanism as Messenger |
| Identify conversations | Yes | Instagram-Scoped ID (IGSID) |
| Identify users | Yes | IGSID + username |
| Retrieve media | Yes | Attachment URL in webhook payload |
| Mark as read | Yes | `sender_action: mark_seen` |
| Delivery/read status | Partial | Delivery confirmed on send; explicit read receipts are inconsistent |
| Send attachments | Yes | Image, video, audio, file |

**Required permissions/setup**: `instagram_business_basic` + `instagram_business_manage_messages`
permissions on a Facebook Login for Business token.

**App review / business verification**: Up to **25 test users** can be messaged with no
App Review, sufficient to prove out the adapter. Messaging Instagram accounts this app doesn't
own requires the same App Review (Advanced Access) + Business Verification as Messenger.

**Restrictions**: Same 24-hour messaging window model as Messenger; DMs only, no comment
management in this MVP.

---

## X (formerly Twitter)

**Status: Pending**

As of 2026, X's tiered free/paid model was replaced by pay-per-use self-serve billing; the
Direct Messages endpoints (`POST /2/dm_conversations`, etc.) are technically reachable to any
paying developer, but every request is metered and billed, and DMs can only be sent to users
who have opted in to receive them from the app. There is no way to exercise this without a
funded, billed developer account tied to a real X app.

Given the direct pay-per-request cost (rather than a flat included quota) and the consent
requirement, this is deliberately left as an **adapter stub** for the MVP: `XAdapter` implements
`ChannelAdapter` and throws `NotImplementedException` from every method, and the channel is
shown in the UI as "Coming soon" rather than "Connected". No fake/simulated sending is done.

**To implement later**: wire `XAdapter` to the v2 DM endpoints once a billed X API account is
available, using the same webhook → queue → normalize pipeline as the other channels.

---

## TikTok

**Status: Unsupported**

TikTok has no general-purpose, self-serve official API for two-way direct messaging with
customers. A "Business Messaging API" exists in TikTok's Business API for Business Partner
program, but it is only available to approved TikTok Business Partners under a restricted
partnership agreement — it is not something any developer can register for and integrate,
unlike WhatsApp/Messenger/Instagram/Telegram. TikTok's general Content Posting/Display/Login
Kit APIs explicitly do not expose DM read/send capability.

Per this project's rules (never fake/simulate an integration, never use unofficial methods),
TikTok is **not implemented**. It appears in the channel registry only as a disabled,
"Planned — pending TikTok partner approval" entry so the UI is honest about its state, and
`TikTokAdapter` is not created until that partner access is realistically obtainable.

---

## Summary table

| Platform | Status | Two-way messaging today | Blocking factor for full production use |
|---|---|---|---|
| WhatsApp | Implemented | Yes (test number) | Business Verification (offline, account-level) |
| Telegram | Implemented | Yes | None |
| Facebook Messenger | Implemented (dev/test mode) | Yes (own Page) | App Review (Advanced Access) + Business Verification |
| Instagram | Implemented (dev/test mode) | Yes (≤25 test users) | App Review (Advanced Access) + Business Verification |
| X | Pending | No | Requires a billed, pay-per-use X API account |
| TikTok | Unsupported | No | No self-serve official messaging API exists |

The MVP's core architecture (adapter interface, conversation/message model, queues, realtime)
does not depend on any single channel — it was proven first against Telegram (zero external
setup) and then WhatsApp (the flagship channel), and the same pipeline is reused unmodified for
Messenger and Instagram.
